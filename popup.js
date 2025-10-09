// Load history and current tab URL when popup opens
document.addEventListener('DOMContentLoaded', async () => {
  loadHistory();
  
  // Get current tab URL and populate input
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.url) {
      document.getElementById('urlInput').value = tab.url;
    }
  } catch (error) {
    console.log('Could not get current tab URL:', error);
  }
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'urlShortened') {
    const resultBox = document.getElementById('resultBox');
    resultBox.textContent = `✓ ${request.shortUrl} (Click to copy)`;
    resultBox.style.background = 'rgba(93, 176, 255, 0.1)';
    resultBox.style.borderColor = 'rgba(93, 176, 255, 0.3)';
    resultBox.style.color = '#5db0ff';
    resultBox.classList.add('show');
    resultBox.dataset.url = request.shortUrl;
    
    // Update input field
    document.getElementById('urlInput').value = request.longUrl;
    
    // Reload history
    loadHistory();
  }
  
  if (request.action === 'urlShortenFailed') {
    const resultBox = document.getElementById('resultBox');
    resultBox.textContent = `❌ ${request.error}`;
    resultBox.style.background = 'rgba(255, 59, 48, 0.1)';
    resultBox.style.borderColor = 'rgba(255, 59, 48, 0.3)';
    resultBox.style.color = '#ff453a';
    resultBox.classList.add('show');
  }
});

// Shorten URL button
document.getElementById('shortenBtn').addEventListener('click', async () => {
  const urlInput = document.getElementById('urlInput');
  const shortenBtn = document.getElementById('shortenBtn');
  const resultBox = document.getElementById('resultBox');
  
  let urlToShorten = urlInput.value.trim();
  
  // If input is empty, get current tab URL
  if (!urlToShorten) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.url) {
        urlToShorten = tab.url;
        urlInput.value = urlToShorten;
      } else {
        resultBox.textContent = '❌ No URL provided';
        resultBox.style.background = 'rgba(255, 59, 48, 0.1)';
        resultBox.style.borderColor = 'rgba(255, 59, 48, 0.3)';
        resultBox.style.color = '#ff453a';
        resultBox.classList.add('show');
        return;
      }
    } catch (error) {
      console.error('Error getting tab URL:', error);
      return;
    }
  }
  
  // Validate URL
  try {
    new URL(urlToShorten);
  } catch {
    resultBox.textContent = '❌ Invalid URL';
    resultBox.style.background = 'rgba(255, 59, 48, 0.1)';
    resultBox.style.borderColor = 'rgba(255, 59, 48, 0.3)';
    resultBox.style.color = '#ff453a';
    resultBox.classList.add('show');
    return;
  }
  
  // Disable button and show loading
  shortenBtn.disabled = true;
  shortenBtn.textContent = 'Shortening...';
  resultBox.classList.remove('show');
  
  // Send message to background script
  chrome.runtime.sendMessage(
    { action: 'shortenUrl', url: urlToShorten },
    (response) => {
      shortenBtn.disabled = false;
      shortenBtn.textContent = 'Shorten';
      
      if (response && response.success) {
        resultBox.textContent = `✓ ${response.shortUrl} (Click to copy)`;
        resultBox.style.background = 'rgba(93, 176, 255, 0.1)';
        resultBox.style.borderColor = 'rgba(93, 176, 255, 0.3)';
        resultBox.style.color = '#5db0ff';
        resultBox.classList.add('show');
        resultBox.dataset.url = response.shortUrl;
        
        // Copy to clipboard automatically
        navigator.clipboard.writeText(response.shortUrl).then(() => {
          console.log('URL copied to clipboard');
        });
        
        // Reload history
        loadHistory();
      } else {
        resultBox.textContent = '❌ Failed to shorten URL';
        resultBox.style.background = 'rgba(255, 59, 48, 0.1)';
        resultBox.style.borderColor = 'rgba(255, 59, 48, 0.3)';
        resultBox.style.color = '#ff453a';
        resultBox.classList.add('show');
      }
    }
  );
});

// Copy result box on click
document.getElementById('resultBox').addEventListener('click', (e) => {
  const url = e.target.dataset.url;
  if (url) {
    navigator.clipboard.writeText(url).then(() => {
      const originalText = e.target.textContent;
      e.target.textContent = '✓ Copied to clipboard!';
      setTimeout(() => {
        e.target.textContent = originalText;
      }, 1500);
    });
  }
});

// Clear history button
document.getElementById('clearHistory').addEventListener('click', () => {
  if (confirm('Clear all URL history?')) {
    chrome.storage.local.set({ urlHistory: [] }, () => {
      loadHistory();
    });
  }
});

// Load history from storage
function loadHistory() {
  chrome.storage.local.get(['urlHistory'], (result) => {
    const history = result.urlHistory || [];
    const historyList = document.getElementById('historyList');
    
    if (history.length === 0) {
      historyList.innerHTML = '<div class="no-history">No shortened URLs yet.<br><br>Click the extension icon to shorten the current page URL.</div>';
      return;
    }
    
    historyList.innerHTML = '';
    
    history.forEach((item, index) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'history-item';
      
      const date = new Date(item.timestamp);
      const dateStr = date.toLocaleString();
      
      itemDiv.innerHTML = `
        <div class="history-item-short" data-url="${item.shortUrl}">${item.shortUrl}</div>
        <div class="history-item-long">${item.longUrl}</div>
        <div class="history-item-date">${dateStr}</div>
      `;
      
      // Copy on click
      itemDiv.querySelector('.history-item-short').addEventListener('click', (e) => {
        const url = e.target.getAttribute('data-url');
        navigator.clipboard.writeText(url).then(() => {
          const originalText = e.target.textContent;
          e.target.textContent = '✓ Copied!';
          setTimeout(() => {
            e.target.textContent = originalText;
          }, 1000);
        });
      });
      
      historyList.appendChild(itemDiv);
    });
  });
}

// Auto-refresh history every second
setInterval(loadHistory, 1000);