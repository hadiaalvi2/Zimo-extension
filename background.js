chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-popup') {
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 540,
      height: 560,
      left: 100,
      top: 100
    });
  }
});

// Listen for extension icon clicks - shorten current URL automatically
chrome.action.onClicked.addListener(async (tab) => {
  console.log('Extension icon clicked for URL:', tab.url);
  const urlToShorten = tab.url;
  
  // First, open the popup immediately
  const popupWindow = await chrome.windows.create({
    url: 'popup.html',
    type: 'popup',
    width: 540,
    height: 560,
    left: 100,
    top: 100
  });
  
  // Wait a bit for popup to load, then shorten URL
  setTimeout(async () => {
    try {
      // Shorten URL using TinyURL API with better error handling
      const response = await fetch(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlToShorten)}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'text/plain'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const shortUrl = await response.text();
      
      // Validate the response
      if (!shortUrl || shortUrl.includes('Error') || !shortUrl.startsWith('http')) {
        throw new Error('Invalid response from URL shortening service');
      }
      
      console.log('Shortened URL:', shortUrl);
      
      // Copy to clipboard using the active tab
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
        console.log('Clipboard copy failed, but URL was shortened:', clipboardError);
      }
      
      // Show success notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/Shapes/W.svg',
        title: 'URL Shortened ✓',
        message: `Copied: ${shortUrl}`,
        priority: 2
      });
      
      // Save to history
      saveToHistory(urlToShorten, shortUrl);
      
      // Send message to popup to update UI
      chrome.runtime.sendMessage({
        action: 'urlShortened',
        longUrl: urlToShorten,
        shortUrl: shortUrl
      });
      
    } catch (error) {
      console.error('Error shortening URL:', error);
      
      // Show error notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/Shapes/W.svg',
        title: 'Failed to shorten URL ✗',
        message: error.message || 'Please try again',
        priority: 2
      });
      
      // Send error to popup
      chrome.runtime.sendMessage({
        action: 'urlShortenFailed',
        error: error.message || 'Failed to shorten URL'
      });
    }
  }, 500);
});

// Save URL history
function saveToHistory(longUrl, shortUrl) {
  chrome.storage.local.get(['urlHistory'], (result) => {
    const history = result.urlHistory || [];
    history.unshift({
      longUrl,
      shortUrl,
      timestamp: new Date().toISOString()
    });
    // Keep only last 50 entries
    if (history.length > 50) {
      history.pop();
    }
    chrome.storage.local.set({ urlHistory: history }, () => {
      console.log('History saved');
    });
  });
}

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
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 540,
      height: 560,
      left: 100,
      top: 100
    });
    return;
  }
  
  if (info.menuItemId === 'shortenUrl') {
    const urlToShorten = info.linkUrl || info.pageUrl || tab.url;
    
    try {
      const response = await fetch(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlToShorten)}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'text/plain'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const shortUrl = await response.text();
      
      if (!shortUrl || shortUrl.includes('Error') || !shortUrl.startsWith('http')) {
        throw new Error('Invalid response from URL shortening service');
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
        iconUrl: 'assets/Shapes/W.svg',
        title: 'URL Shortened ✓',
        message: `Copied: ${shortUrl}`,
        priority: 2
      });
      
      // Save to history
      saveToHistory(urlToShorten, shortUrl);
      
    } catch (error) {
      console.error('Error shortening URL:', error);
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/Shapes/W.svg',
        title: 'Failed to shorten URL ✗',
        message: 'Please try again',
        priority: 2
      });
    }
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openPopup') {
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 540,
      height: 560,
      left: 100,
      top: 100
    });
  }
  
  if (request.action === 'shortenUrl') {
    const urlToShorten = request.url;
    
    fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlToShorten)}`, {
      method: 'GET',
      headers: {
        'Accept': 'text/plain'
      }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.text();
      })
      .then(shortUrl => {
        // Validate the response
        if (!shortUrl || shortUrl.includes('Error') || !shortUrl.startsWith('http')) {
          throw new Error('Invalid response from URL shortening service');
        }
        
        // Save to history
        saveToHistory(urlToShorten, shortUrl);
        
        // Send response back
        sendResponse({ success: true, shortUrl: shortUrl });
      })
      .catch(error => {
        console.error('Error shortening URL:', error);
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Keep message channel open for async response
  }
});

// Keep service worker alive
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension started');
});