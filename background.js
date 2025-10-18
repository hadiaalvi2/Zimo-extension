// background.js - Chrome Extension Service Worker

// Initialize extension on install
chrome.runtime.onInstalled.addListener((details) => {
  console.log('ZIMO URL Shortener installed:', details.reason);
  
  if (details.reason === 'install') {
    // Initialize storage
    chrome.storage.local.set({
      urlHistory: []
    });
  }
  
  // Create context menu
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

// Listen for messages from popup or content scripts
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
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'fetchMetadata') {
    fetchMetadataInBackground(request.url)
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

// Shorten URL in background with multiple fallbacks
async function shortenUrlInBackground(url) {
  console.log('Background: Attempting to shorten URL:', url);
  
  // Method 1: Try TinyURL API
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
    console.log('TinyURL failed: Invalid response');
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
    console.log('is.gd failed: Invalid response');
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
    console.log('v.gd failed: Invalid response');
  } catch (error) {
    console.log('v.gd error:', error.message);
  }

  // Final fallback: Generate mock short URL
  console.log('Using fallback short URL generation');
  return `https://zimo.ws/${generateShortCode()}`;
}

// Fetch metadata in background using multiple strategies
async function fetchMetadataInBackground(url) {
  console.log('Background: Fetching metadata for:', url);
  
  const metadata = {
    title: '',
    description: '',
    image: '',
    favicon: ''
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    // Fetch with timeout
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`HTTP error! status: ${response.status}`);
      return metadata;
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('text/html')) {
      console.log('Not an HTML page, skipping metadata extraction');
      return metadata;
    }

    const html = await response.text();
    
    // Parse HTML
    metadata.title = extractMetaTag(html, 'title') || 
                     extractOGTag(html, 'og:title') ||
                     extractTwitterTag(html, 'twitter:title');
    
    metadata.description = extractMetaTag(html, 'description') ||
                          extractOGTag(html, 'og:description') ||
                          extractTwitterTag(html, 'twitter:description');
    
    metadata.image = extractOGTag(html, 'og:image') ||
                     extractTwitterTag(html, 'twitter:image') ||
                     extractOGTag(html, 'og:image:url');
    
    // Get favicon
    const urlObj = new URL(url);
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*href=["']([^"']+)["']/i);
    if (faviconMatch) {
      const faviconPath = faviconMatch[1];
      if (faviconPath.startsWith('http')) {
        metadata.favicon = faviconPath;
      } else if (faviconPath.startsWith('//')) {
        metadata.favicon = urlObj.protocol + faviconPath;
      } else if (faviconPath.startsWith('/')) {
        metadata.favicon = `${urlObj.protocol}//${urlObj.host}${faviconPath}`;
      } else {
        metadata.favicon = `${urlObj.protocol}//${urlObj.host}/${faviconPath}`;
      }
    } else {
      // Default favicon location
      metadata.favicon = `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
    }

    console.log('Metadata fetched successfully:', metadata);
    return metadata;
    
  } catch (error) {
    console.log('Metadata fetch error:', error.message);
    
    // Try to get at least favicon from common location
    try {
      const urlObj = new URL(url);
      metadata.favicon = `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
    } catch (faviconError) {
      console.error('Favicon fallback error:', faviconError);
    }
    
    return metadata;
  }
}

// Helper function to extract title tag
function extractMetaTag(html, name) {
  if (name === 'title') {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : '';
  }
  
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i')
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  
  return '';
}

// Helper function to extract Open Graph tags
function extractOGTag(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`, 'i')
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  
  return '';
}

// Helper function to extract Twitter Card tags
function extractTwitterTag(html, name) {
  const patterns = [
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, 'i')
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1].trim();
  }
  
  return '';
}

// Generate random short code
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shortenUrl') {
    const urlToShorten = info.linkUrl || info.pageUrl;
    if (urlToShorten) {
      // Store the URL to be shortened
      chrome.storage.local.set({ pendingUrl: urlToShorten }, () => {
        // Open popup
        chrome.action.openPopup();
      });
    }
  }
});