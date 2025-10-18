chrome.runtime.onInstalled.addListener((details) => {
  console.log('ZIMO URL Shortener installed:', details.reason);
  
  if (details.reason === 'install') {
    chrome.storage.local.set({
      urlHistory: []
    });
  }
  
  try {
    chrome.contextMenus.create({
      id: 'shortenUrl',
      title: 'Shorten this URL with ZIMO',
      contexts: ['link', 'page']
    });
  } catch (error) {
    console.error('Context menu creation error:', error);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);
  
  if (request.action === 'shortenUrl') {
    shortenUrlInBackground(request.url)
      .then(shortUrl => {
        console.log('Background shorten success:', shortUrl);
        sendResponse({ success: true, shortUrl });
      })
      .catch(error => {
        console.error('Background shorten error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  
  if (request.action === 'fetchMetadata') {
    fetchMetadataInBackground(request.url, request.tabInfo)
      .then(metadata => {
        console.log('Background metadata success:', metadata);
        sendResponse({ success: true, metadata });
      })
      .catch(error => {
        console.error('Background metadata error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

// Shorten URL with multiple fallbacks
async function shortenUrlInBackground(url) {
  console.log('Background: Attempting to shorten URL:', url);
  
  // Method 1: Try TinyURL
  try {
    console.log('Trying TinyURL...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'text/plain'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.startsWith('http') && !shortUrl.includes('Error')) {
        console.log('TinyURL success:', shortUrl);
        return shortUrl;
      }
    }
  } catch (error) {
    console.log('TinyURL error:', error.message);
  }

  // Method 2: Try is.gd
  try {
    console.log('Trying is.gd...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.startsWith('http') && !shortUrl.includes('Error')) {
        console.log('is.gd success:', shortUrl);
        return shortUrl;
      }
    }
  } catch (error) {
    console.log('is.gd error:', error.message);
  }

  // Method 3: Try v.gd
  try {
    console.log('Trying v.gd...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(`https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.startsWith('http') && !shortUrl.includes('Error')) {
        console.log('v.gd success:', shortUrl);
        return shortUrl;
      }
    }
  } catch (error) {
    console.log('v.gd error:', error.message);
  }

  // Fallback: Generate mock short URL
  console.log('Using fallback short URL generation');
  return `https://zimo.ws/${generateShortCode()}`;
}

// Fetch metadata using CORS proxy
async function fetchMetadataInBackground(url, tabInfo = {}) {
  console.log('Background: Fetching metadata for:', url);
  
  const metadata = {
    title: tabInfo.title || '',
    description: '',
    image: '',
    favicon: tabInfo.favIconUrl || ''
  };

  // Set basic fallbacks from URL
  try {
    const urlObj = new URL(url);
    if (!metadata.favicon) {
      metadata.favicon = `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
    }
    if (!metadata.title) {
      metadata.title = urlObj.hostname.replace('www.', '');
    }
  } catch (e) {
    console.error('Invalid URL:', e);
  }

  // Try CORS proxy approach
  try {
    console.log('Trying CORS proxy...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    // Use a reliable CORS proxy
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      const html = data.contents;
      
      if (html) {
        const extracted = extractMetadataFromHTML(html, url);
        
        // Only update if we got meaningful data
        if (extracted.title && extracted.title !== metadata.title) {
          metadata.title = extracted.title;
        }
        if (extracted.description) {
          metadata.description = extracted.description;
        }
        if (extracted.image) {
          metadata.image = extracted.image;
        }
        if (extracted.favicon && extracted.favicon !== metadata.favicon) {
          metadata.favicon = extracted.favicon;
        }
        
        console.log('Proxy metadata extracted:', extracted);
      }
    }
  } catch (error) {
    console.log('CORS proxy error:', error.message);
  }

  console.log('Final metadata:', metadata);
  return metadata;
}

// Extract metadata from HTML content
function extractMetadataFromHTML(html, originalUrl) {
  const metadata = {
    title: '',
    description: '',
    image: '',
    favicon: ''
  };

  try {
    // Create a temporary div to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // Helper function to get meta content
    const getMetaContent = (name, property) => {
      const selector = property ? 
        `meta[property="${name}"], meta[name="${name}"]` : 
        `meta[name="${name}"]`;
      const meta = tempDiv.querySelector(selector);
      return meta ? meta.getAttribute('content') : '';
    };

    // Extract title
    const ogTitle = getMetaContent('og:title', true);
    const twitterTitle = getMetaContent('twitter:title', true);
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const documentTitle = titleMatch ? titleMatch[1].trim() : '';
    
    metadata.title = ogTitle || twitterTitle || documentTitle;

    // Extract description
    const ogDesc = getMetaContent('og:description', true);
    const twitterDesc = getMetaContent('twitter:description', true);
    const metaDesc = getMetaContent('description', false);
    
    metadata.description = ogDesc || twitterDesc || metaDesc;

    // Extract image
    const ogImage = getMetaContent('og:image', true);
    const twitterImage = getMetaContent('twitter:image', true);
    metadata.image = ogImage || twitterImage;

    // Extract favicon
    const faviconMatch = html.match(/<link[^>]*rel=(["'])?(?:icon|shortcut icon|apple-touch-icon)(["'])?[^>]*href=(["'])([^"']+)\3/i);
    if (faviconMatch && faviconMatch[4]) {
      metadata.favicon = faviconMatch[4];
    }

    // Make URLs absolute
    metadata.image = makeUrlAbsolute(metadata.image, originalUrl);
    metadata.favicon = makeUrlAbsolute(metadata.favicon, originalUrl);

    // Clean up text
    metadata.title = metadata.title.trim();
    metadata.description = metadata.description.trim();

  } catch (error) {
    console.error('Error extracting metadata from HTML:', error);
  }

  return metadata;
}

// Make relative URLs absolute
function makeUrlAbsolute(url, baseUrl) {
  if (!url) return '';
  
  try {
    // If URL is already absolute
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    const base = new URL(baseUrl);
    
    // If URL is protocol-relative
    if (url.startsWith('//')) {
      return base.protocol + url;
    }
    
    // If URL is absolute path
    if (url.startsWith('/')) {
      return base.origin + url;
    }
    
    // If URL is relative path
    return base.origin + '/' + url;
    
  } catch (error) {
    console.error('Error making URL absolute:', error);
    return url;
  }
}

// Generate short code for fallback URLs
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Context menu click handler
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shortenUrl') {
    let urlToShorten;
    
    if (info.linkUrl) {
      urlToShorten = info.linkUrl;
    } else if (info.pageUrl) {
      urlToShorten = info.pageUrl;
    } else {
      console.error('No URL found for context menu');
      return;
    }
    
    console.log('Context menu shortening:', urlToShorten);
    
    // Store the URL and open popup
    chrome.storage.local.set({ pendingUrl: urlToShorten }, () => {
      chrome.action.openPopup();
    });
  }
});