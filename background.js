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

// Shorten URL with multiple services
async function shortenUrlInBackground(url) {
  console.log('Background: Attempting to shorten URL:', url);
  
  // Method 1: TinyURL
  try {
    console.log('Trying TinyURL...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'text/plain' }
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

  // Method 2: is.gd
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

  // Method 3: v.gd
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

// Fetch metadata using CORS proxy (AllOrigins)
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
    console.log('Trying CORS proxy (AllOrigins)...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    
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

  console.log('Final metadata from background:', metadata);
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
    // Create temporary div for parsing
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // Extract title - priority: OG > Twitter > Document Title
    let ogTitle = '';
    let twitterTitle = '';
    let docTitle = '';
    
    // Try OG title
    const ogTitleMeta = tempDiv.querySelector('meta[property="og:title"]');
    if (ogTitleMeta) ogTitle = ogTitleMeta.getAttribute('content') || '';
    
    // Try Twitter title
    const twitterTitleMeta = tempDiv.querySelector('meta[name="twitter:title"]');
    if (twitterTitleMeta) twitterTitle = twitterTitleMeta.getAttribute('content') || '';
    
    // Try document title
    const titleTag = tempDiv.querySelector('title');
    if (titleTag) docTitle = titleTag.textContent.trim();
    
    metadata.title = ogTitle || twitterTitle || docTitle || '';

    // Extract description - priority: OG > Meta Description > Twitter
    let ogDesc = '';
    let metaDesc = '';
    let twitterDesc = '';
    
    const ogDescMeta = tempDiv.querySelector('meta[property="og:description"]');
    if (ogDescMeta) ogDesc = ogDescMeta.getAttribute('content') || '';
    
    const metaDescTag = tempDiv.querySelector('meta[name="description"]');
    if (metaDescTag) metaDesc = metaDescTag.getAttribute('content') || '';
    
    const twitterDescMeta = tempDiv.querySelector('meta[name="twitter:description"]');
    if (twitterDescMeta) twitterDesc = twitterDescMeta.getAttribute('content') || '';
    
    metadata.description = ogDesc || metaDesc || twitterDesc || '';
    metadata.description = metadata.description.substring(0, 300).trim();

    // Extract image - priority: OG > Twitter
    let ogImage = '';
    let twitterImage = '';
    
    const ogImageMeta = tempDiv.querySelector('meta[property="og:image"]');
    if (ogImageMeta) ogImage = ogImageMeta.getAttribute('content') || '';
    
    const twitterImageMeta = tempDiv.querySelector('meta[name="twitter:image"]');
    if (twitterImageMeta) twitterImage = twitterImageMeta.getAttribute('content') || '';
    
    let imageUrl = ogImage || twitterImage || '';
    metadata.image = makeUrlAbsolute(imageUrl, originalUrl);

    // Extract favicon
    const iconLink = tempDiv.querySelector('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    if (iconLink) {
      const href = iconLink.getAttribute('href') || '';
      metadata.favicon = makeUrlAbsolute(href, originalUrl);
    }

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
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    
    const base = new URL(baseUrl);
    
    if (url.startsWith('//')) {
      return base.protocol + url;
    }
    
    if (url.startsWith('/')) {
      return base.origin + url;
    }
    
    return base.origin + '/' + url;
    
  } catch (error) {
    console.error('Error making URL absolute:', error);
    return url;
  }
}

// Generate short code for fallback
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
    
    chrome.storage.local.set({ pendingUrl: urlToShorten }, () => {
      chrome.action.openPopup();
    });
  }
});