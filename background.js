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

// Fetch page metadata from original URL
async function fetchPageMetadataFromUrl(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw new Error('Failed to fetch URL');
    
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
        favicon = new URL(url).origin + (favicon.startsWith('/') ? favicon : '/' + favicon);
      }
    }

    // Fallback to standard favicon location if not found
    if (!favicon) {
      favicon = new URL(url).origin + '/favicon.ico';
    }

    const title = getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]'
    ]) || doc.querySelector('title')?.textContent || 'Untitled Page';

    return {
      title,
      favicon
    };
  } catch (error) {
    console.error('Error fetching metadata from URL:', error);
    return null;
  }
}

// Fetch page title using content script (fallback)
async function fetchPageTitle(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const getMetaContent = (selectors) => {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              return element.content || element.textContent || element.href;
            }
          }
          return '';
        };

        return getMetaContent([
          'meta[property="og:title"]',
          'meta[name="twitter:title"]',
          'meta[name="title"]'
        ]) || document.title || 'Untitled Page';
      }
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    return 'Untitled Page';
  } catch (error) {
    console.error('Error fetching page title:', error);
    return 'Untitled Page';
  }
}

// Save to history
function saveToHistory(longUrl, shortUrl, title) {
  chrome.storage.local.get(['urlHistory'], (result) => {
    const history = result.urlHistory || [];
    history.unshift({
      longUrl,
      shortUrl,
      title,
      timestamp: new Date().toISOString()
    });
    
    if (history.length > 50) {
      history.pop();
    }
    
    chrome.storage.local.set({ urlHistory: history }, () => {
      console.log('History saved');
    });
  });
}

// Listen for extension icon clicks
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked for URL:', tab.url);
  const urlToShorten = tab.url;
  
  try {
    // Shorten URL
    const shortUrl = await shortenUrl(urlToShorten);
    
    // Try to fetch metadata from URL, fallback to content script
    let pageData = await fetchPageMetadataFromUrl(urlToShorten);
    let pageTitle = pageData?.title || 'Untitled Page';
    let favicon = pageData?.favicon;
    
    if (!pageTitle || pageTitle === 'Untitled Page') {
      pageTitle = await fetchPageTitle(tab.id);
    }
    
    // Copy to clipboard
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => {
          navigator.clipboard.writeText(text).then(() => {
            console.log('URL copied to clipboard:', text);
          }).catch(err => {
            console.error('Clipboard error:', err);
          });
        },
        args: [shortUrl]
      });
    } catch (clipboardError) {
      console.log('Clipboard copy failed, but URL was shortened');
    }
    
    // Show success notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23667eea"/><text x="50" y="70" font-size="60" font-weight="bold" fill="white" text-anchor="middle">WS</text></svg>',
      title: 'URL Shortened ✓',
      message: `Copied: ${shortUrl}`,
      priority: 2
    });
    
    // Save to history
    saveToHistory(urlToShorten, shortUrl, pageTitle);
    
  } catch (error) {
    console.error('Error shortening URL:', error);
    
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23667eea"/><text x="50" y="70" font-size="60" font-weight="bold" fill="white" text-anchor="middle">WS</text></svg>',
      title: 'Failed to shorten URL ✗',
      message: error.message || 'Please try again',
      priority: 2
    });
  }
});

// Context menu setup
chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated');
  
  chrome.contextMenus.create({
    id: 'shortenUrl',
    title: 'Shorten this URL',
    contexts: ['page', 'link']
  });
  
  chrome.contextMenus.create({
    id: 'openHistory',
    title: 'View URL History',
    contexts: ['action']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'openHistory') {
    chrome.action.openPopup();
    return;
  }
  
  if (info.menuItemId === 'shortenUrl') {
    const urlToShorten = info.linkUrl || info.pageUrl || tab.url;
    
    try {
      const shortUrl = await shortenUrl(urlToShorten);
      
      // Try to fetch metadata from URL, fallback to content script
      let pageData = await fetchPageMetadataFromUrl(urlToShorten);
      let pageTitle = pageData?.title || 'Untitled Page';
      
      if (!pageTitle || pageTitle === 'Untitled Page') {
        pageTitle = await fetchPageTitle(tab.id);
      }
      
      // Copy to clipboard
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (text) => {
          navigator.clipboard.writeText(text);
        },
        args: [shortUrl]
      });
      
      // Show notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23667eea"/><text x="50" y="70" font-size="60" font-weight="bold" fill="white" text-anchor="middle">WS</text></svg>',
        title: 'URL Shortened ✓',
        message: `Copied: ${shortUrl}`,
        priority: 2
      });
      
      // Save to history
      saveToHistory(urlToShorten, shortUrl, pageTitle);
      
    } catch (error) {
      console.error('Error shortening URL:', error);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23667eea"/><text x="50" y="70" font-size="60" font-weight="bold" fill="white" text-anchor="middle">WS</text></svg>',
        title: 'Failed to shorten URL ✗',
        message: 'Please try again',
        priority: 2
      });
    }
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'shortenUrl') {
    shortenUrl(request.url)
      .then(shortUrl => {
        saveToHistory(request.url, shortUrl, request.title || 'Untitled Page');
        sendResponse({ success: true, shortUrl: shortUrl });
      })
      .catch(error => {
        console.error('Error shortening URL:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true;
  }
});

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension started');
});