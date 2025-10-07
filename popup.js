// Load and display history when popup opens
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
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
      
    
      itemDiv.querySelector('.history-item-short').addEventListener('click', (e) => {
        const url = e.target.getAttribute('data-url');
        navigator.clipboard.writeText(url).then(() => {
          e.target.textContent = '✓ Copied!';
          setTimeout(() => {
            e.target.textContent = url;
          }, 1000);
        });
      });
      
      historyList.appendChild(itemDiv);
    });
  });
}

setInterval(loadHistory, 1000);