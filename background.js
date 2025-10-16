// Keep service worker alive
let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // Just to keep the service worker alive
    });
  }, 20000); // Every 20 seconds
}

startKeepAlive();

// Shorten URL function
async function shortenUrl(url) {
  const services = [
    {
      name: 'is.gd',
      url: `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
      method: 'GET'
    },
    {
      name: 'v.gd',
      url: `https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}`,
      method: 'GET'
    },
    {
      name: 'TinyURL',
      url: `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`,
      method: 'GET'
    }
  ];

  for (const service of services) {
    try {
      const response = await fetch(service.url, {
        method: service.method,
        headers: {
          'Accept': 'text/plain'
        }
      });

      if (response.ok) {
        const shortUrl = await response.text();
        if (shortUrl && !shortUrl.includes('Error') && shortUrl.startsWith('http')) {
          return shortUrl.trim();
        }
      }
    } catch (error) {
      console.error(`${service.name} failed:`, error);
    }
  }

  throw new Error('All URL shortening services failed');
}

// Fetch COMPLETE page metadata from ORIGINAL URL (runs in background with full permissions)
async function fetchPageMetadataFromUrl(url) {
  try {
    console.log('Background: Fetching metadata from ORIGINAL URL:', url);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, { 
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error('Response not OK:', response.status);
      throw new Error('Failed to fetch URL');
    }
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const getMetaContent = (selectors) => {
      for (const selector of selectors) {
        const element = doc.querySelector(selector);
        if (element) {
          return element.content || element.textContent || element.href;
        }
      }
      return '';
    };

    // Get title
    const title = getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]'
    ]) || doc.querySelector('title')?.textContent || 'Untitled Page';

    // Get description
    const description = getMetaContent([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]'
    ]);

    // Get site name
    const siteName = getMetaContent([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]'
    ]);

    // Get image
    const image = getMetaContent([
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]'
    ]);

    // Get favicon
    let favicon = getMetaContent([
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]'
    ]);

    // Resolve relative favicon URLs to absolute URLs
    if (favicon && !favicon.startsWith('http')) {
      try {
        favicon = new URL(favicon, url).href;
      } catch (e) {
        const urlObj = new URL(url);
        favicon = urlObj.origin + (favicon.startsWith('/') ? favicon : '/' + favicon);
      }
    }

    // Fallback to standard favicon location if not found
    if (!favicon) {
      const urlObj = new URL(url);
      favicon = `${urlObj.origin}/favicon.ico`;
    }

    const metadata = {
      title: title.trim(),
      description: description?.trim() || '',
      siteName: siteName?.trim() || '',
      image: image || '',
      favicon: favicon
    };

    console.log('Background: Fetched complete metadata:', metadata);
    return metadata;
  } catch (error) {
    console.error('Background: Error fetching metadata from URL:', error);
    return {
      title: 'Untitled Page',
      description: '',
      siteName: '',
      image: '',
      favicon: ''
    };
  }
}

// Track short URL clicks
async function trackShortUrlClick(shortUrl) {
  try {
    const result = await chrome.storage.local.get(['urlHistory', 'urlClickCount']);
    const history = result.urlHistory || [];
    let clickCount = result.urlClickCount || {};

    // Increment click count
    clickCount[shortUrl] = (clickCount[shortUrl] || 1) + 1;

    // Update history items with this short URL
    history.forEach(item => {
      if (item.shortUrl === shortUrl) {
        item.clickCount = clickCount[shortUrl];
      }
    });

    // Move the item to top
    const itemIndex = history.findIndex(item => item.shortUrl === shortUrl);
    if (itemIndex > 0) {
      const [item] = history.splice(itemIndex, 1);
      history.unshift(item);
    }

    await chrome.storage.local.set({ urlHistory: history, urlClickCount: clickCount });
    console.log(`Click tracked for ${shortUrl}: ${clickCount[shortUrl]}`);
  } catch (error) {
    console.error('Error tracking click:', error);
  }
}

// Listen for tab updates to track when short URLs are opened
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    // Check if it's one of our shortened URLs
    const knownShorteners = ['is.gd', 'v.gd', 'tinyurl.com'];
    const isShortUrl = knownShorteners.some(shortener => tab.url.includes(shortener));
    
    if (isShortUrl) {
      // Extract the short URL
      const shortUrl = tab.url.split('?')[0]; // Remove query params if any
      trackShortUrlClick(shortUrl);
    }
  }
});

// Handle context menu clicks for sharing
chrome.contextMenus.create({
  id: 'shorten-url',
  title: 'Shorten this link',
  contexts: ['link']
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shorten-url') {
    console.log('Context menu shorten:', info.linkUrl);
  }
});

// FIXED: Message listener with proper async handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);
  
  // Handle async operations properly
  (async () => {
    try {
      if (request.action === 'fetchMetadata') {
        console.log('Fetching metadata for:', request.url);
        const metadata = await fetchPageMetadataFromUrl(request.url);
        sendResponse({ success: true, metadata });
      } 
      else if (request.action === 'shortenUrl') {
        console.log('Shortening URL:', request.url);
        const shortUrl = await shortenUrl(request.url);
        sendResponse({ success: true, shortUrl });
      } 
      else if (request.action === 'resolveShortUrl') {
        console.log('Resolving short URL:', request.shortUrl);
        const originalUrl = await resolveShortUrl(request.shortUrl);
        sendResponse({ success: true, originalUrl });
      }
      else {
        sendResponse({ success: false, error: 'Unknown action: ' + request.action });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep channel open for async response
});

// Resolve shortened URL to original URL
async function resolveShortUrl(shortUrl) {
  try {
    console.log('Resolving short URL:', shortUrl);
    const response = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'follow'
    });
    
    const finalUrl = response.url;
    console.log('Resolved to:', finalUrl);
    return finalUrl;
  } catch (error) {
    console.error('Error resolving short URL:', error);
    throw error;
  }
}

// Log when service worker starts
console.log('Background service worker started at:', new Date().toISOString());