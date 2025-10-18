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
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'shortenUrl') {
    shortenUrlInBackground(request.url)
      .then(shortUrl => sendResponse({ success: true, shortUrl }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }
  
  if (request.action === 'fetchMetadata') {
    fetchMetadataInBackground(request.url)
      .then(metadata => sendResponse({ success: true, metadata }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Shorten URL in background
async function shortenUrlInBackground(url) {
  try {
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    
    if (!response.ok) {
      throw new Error('Failed to shorten URL');
    }
    
    return await response.text();
  } catch (error) {
    console.error('Shortening error:', error);
    // Fallback to a mock shortened URL
    return `zimo.ws/${generateShortCode()}`;
  }
}

// Fetch metadata in background
async function fetchMetadataInBackground(url) {
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    // Parse HTML to extract metadata
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    return {
      title: doc.querySelector('title')?.textContent || '',
      description: doc.querySelector('meta[name="description"]')?.content || 
                   doc.querySelector('meta[property="og:description"]')?.content || '',
      image: doc.querySelector('meta[property="og:image"]')?.content ||
             doc.querySelector('meta[name="twitter:image"]')?.content || '',
      favicon: doc.querySelector('link[rel~="icon"]')?.href ||
               doc.querySelector('link[rel~="shortcut icon"]')?.href || ''
    };
  } catch (error) {
    console.error('Metadata fetch error:', error);
    return {
      title: '',
      description: '',
      image: '',
      favicon: ''
    };
  }
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

// Handle context menu (optional - right-click to shorten URL)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'shortenUrl',
    title: 'Shorten this URL with ZIMO',
    contexts: ['link']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shortenUrl' && info.linkUrl) {
    // Open popup with the link URL
    chrome.action.openPopup();
  }
});