chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-popup') {
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 520,
      height: 505
    });
  }
});

// Listen for extension icon clicks
chrome.action.onClicked.addListener(async (tab) => {
  const urlToShorten = tab.url;
  
  try {
    // Shorten URL using TinyURL API
    const response = await fetch(
      `https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlToShorten)}`
    );
    
    if (!response.ok) {
      throw new Error('Failed to shorten URL');
    }
    
    const shortUrl = await response.text();
    
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (text) => {
        navigator.clipboard.writeText(text).then(() => {
          console.log('URL copied to clipboard:', text);
        });
      },
      args: [shortUrl]
    });
    
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
  }
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
    chrome.storage.local.set({ urlHistory: history });
  });
}

// Optional: Add context menu item for right-click shortening
chrome.runtime.onInstalled.addListener(() => {
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
      width: 520,
      height: 505
    });
    return;
  }
  
  if (info.menuItemId === 'shortenUrl') {
    const urlToShorten = info.linkUrl || info.pageUrl || tab.url;
    
    try {
      const response = await fetch(
        `https://tinyurl.com/api-create.php?url=${encodeURIComponent(urlToShorten)}`
      );
      const shortUrl = await response.text();
      
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

// Listen for messages to open popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openPopup') {
    chrome.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 520,
      height: 505
    });
  }
});