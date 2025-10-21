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

// Shorten URL with multiple services in parallel
async function shortenUrlInBackground(url) {
  console.log('Background: Attempting to shorten URL:', url);
  
  // Try all services in parallel, first success wins
  const services = [
    tryTinyURL(url),
    tryIsGd(url),
    tryVGd(url),
    tryCleanURI(url)
  ];
  
  try {
    // Race all services - whoever responds first wins
    const results = await Promise.allSettled(services);
    
    // Find first successful result
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        console.log('✓ Service succeeded:', result.value);
        return result.value;
      }
    }
  } catch (error) {
    console.log('All services race failed:', error);
  }
  
  // If all fail, return original URL
  console.warn('All URL shortening services failed. Using original URL.');
  return url;
}

// TinyURL service
async function tryTinyURL(url) {
  console.log('→ Trying TinyURL...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal: controller.signal,
      headers: { 'Accept': 'text/plain' }
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.startsWith('http') && !shortUrl.includes('Error')) {
        console.log('  ✓ TinyURL success:', shortUrl);
        return shortUrl;
      }
    }
    throw new Error('TinyURL failed');
  } catch (error) {
    clearTimeout(timeoutId);
    console.log('  ✗ TinyURL error:', error.message);
    throw error;
  }
}

// is.gd service
async function tryIsGd(url) {
  console.log('→ Trying is.gd...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.startsWith('http') && !shortUrl.includes('Error')) {
        console.log('  ✓ is.gd success:', shortUrl);
        return shortUrl;
      }
    }
    throw new Error('is.gd failed');
  } catch (error) {
    clearTimeout(timeoutId);
    console.log('  ✗ is.gd error:', error.message);
    throw error;
  }
}

// v.gd service
async function tryVGd(url) {
  console.log('→ Trying v.gd...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.startsWith('http') && !shortUrl.includes('Error')) {
        console.log('  ✓ v.gd success:', shortUrl);
        return shortUrl;
      }
    }
    throw new Error('v.gd failed');
  } catch (error) {
    clearTimeout(timeoutId);
    console.log('  ✗ v.gd error:', error.message);
    throw error;
  }
}

// CleanURI service
async function tryCleanURI(url) {
  console.log('→ Trying CleanURI...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`https://cleanuri.com/api/v1/shorten`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `url=${encodeURIComponent(url)}`
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (data.result_url && data.result_url.startsWith('http')) {
        console.log('  ✓ CleanURI success:', data.result_url);
        return data.result_url;
      }
    }
    throw new Error('CleanURI failed');
  } catch (error) {
    clearTimeout(timeoutId);
    console.log('  ✗ CleanURI error:', error.message);
    throw error;
  }
}

// Fetch metadata using CORS proxy with improved speed
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

  // Try multiple CORS proxies in parallel
  const proxyAttempts = [
    fetchViaAllOrigins(url),
    fetchViaCorsproxy(url)
  ];

  try {
    // Race the proxies - first one wins
    const htmlContent = await Promise.race(
      proxyAttempts.map(p => p.catch(err => {
        console.log('Proxy failed:', err.message);
        return null;
      }))
    );
    
    if (htmlContent) {
      const extracted = extractMetadataFromHTML(htmlContent, url);
      
      // Merge extracted data with fallbacks
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
      
      console.log('✓ Metadata extracted via proxy:', extracted);
    }
  } catch (error) {
    console.log('⚠️ All proxy attempts failed:', error.message);
  }

  console.log('Final metadata from background:', metadata);
  return metadata;
}

// Fetch via AllOrigins
async function fetchViaAllOrigins(url) {
  console.log('  → Trying AllOrigins proxy...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (data.contents) {
        console.log('    ✓ AllOrigins success');
        return data.contents;
      }
    }
    throw new Error('AllOrigins returned no content');
  } catch (error) {
    clearTimeout(timeoutId);
    console.log('    ✗ AllOrigins failed:', error.message);
    throw error;
  }
}

// Fetch via corsproxy.io
async function fetchViaCorsproxy(url) {
  console.log('  → Trying corsproxy.io...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const html = await response.text();
      if (html && html.length > 100) {
        console.log('    ✓ corsproxy.io success');
        return html;
      }
    }
    throw new Error('corsproxy.io returned no content');
  } catch (error) {
    clearTimeout(timeoutId);
    console.log('    ✗ corsproxy.io failed:', error.message);
    throw error;
  }
}

// Extract metadata from HTML content (optimized)
function extractMetadataFromHTML(html, originalUrl) {
  const metadata = {
    title: '',
    description: '',
    image: '',
    favicon: ''
  };

  try {
    // Use regex for faster parsing (no DOM creation)
    
    // Extract title - OG title has priority
    let ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    let twitterTitle = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
    let docTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    
    metadata.title = (ogTitle?.[1] || twitterTitle?.[1] || docTitle?.[1] || '').trim();

    // Extract description
    let ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    let metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    let twitterDesc = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i);
    
    metadata.description = (ogDesc?.[1] || metaDesc?.[1] || twitterDesc?.[1] || '').trim().substring(0, 300);

    // Extract image
    let ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    let twitterImage = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
    
    let imageUrl = ogImage?.[1] || twitterImage?.[1] || '';
    metadata.image = makeUrlAbsolute(imageUrl, originalUrl);

    // Extract favicon
    let iconLink = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i);
    if (iconLink?.[1]) {
      metadata.favicon = makeUrlAbsolute(iconLink[1], originalUrl);
    }

    // Clean up text
    metadata.title = metadata.title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    metadata.description = metadata.description.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

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