// Elements
const urlInput = document.getElementById('urlInput');
const shortenBtn = document.getElementById('shortenBtn');
const resultBox = document.getElementById('resultBox');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistory');
const historyBtn = document.getElementById('historyBtn');

// History storage key
const HISTORY_KEY = 'urlShortenerHistory';
let history = [];

// Get current tab URL
async function getCurrentTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab.url;
  } catch (error) {
    console.error('Error getting tab URL:', error);
    return '';
  }
}

// Shorten URL using TinyURL API
async function shortenUrl(url) {
  try {
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (!response.ok) throw new Error('TinyURL failed');
    return await response.text();
  } catch (error) {
    // Fallback to is.gd
    try {
      const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
      if (!response.ok) throw new Error('is.gd failed');
      return await response.text();
    } catch (fallbackError) {
      throw new Error('Failed to shorten URL. Please try again.');
    }
  }
}

// Load history from storage
function loadHistory() {
  const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) || '[]');
  history = stored;
  renderHistory();
}

// Save history to storage
function saveHistory() {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

// Add to history
function addToHistory(originalUrl, shortUrl) {
  const entry = {
    original: originalUrl,
    short: shortUrl,
    date: new Date().toISOString(),
    timestamp: Date.now()
  };
  
  // Remove duplicate if exists
  history = history.filter(item => item.original !== originalUrl);
  
  // Add to beginning
  history.unshift(entry);
  
  // Keep only last 10 entries
  if (history.length > 10) {
    history = history.slice(0, 10);
  }
  
  saveHistory();
  renderHistory();
}

// Format date
function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
  });
}

// Render history
function renderHistory() {
  if (history.length === 0) {
    historyList.innerHTML = '<div class="no-history">No shortened URLs yet.<br>Shorten your first URL above!</div>';
    return;
  }
  
  historyList.innerHTML = history.map(item => `
    <div class="history-item" data-url="${item.short}">
      <div class="history-item-short" title="Click to copy">${item.short}</div>
      <div class="history-item-long">${item.original}</div>
      <div class="history-item-date">${formatDate(item.date)}</div>
    </div>
  `).join('');
  
  // Add click listeners
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', async () => {
      const url = item.getAttribute('data-url');
      await copyToClipboard(url);
      showCopyFeedback(item);
    });
  });
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Copy failed:', error);
    return false;
  }
}

// Show copy feedback
function showCopyFeedback(element) {
  const originalBg = element.style.background;
  element.style.background = 'rgba(93, 176, 255, 0.2)';
  
  setTimeout(() => {
    element.style.background = originalBg;
  }, 300);
}

// Handle shorten button click
async function handleShorten() {
  let url = urlInput.value.trim();
  
  // If input is empty, use current tab URL
  if (!url) {
    url = await getCurrentTabUrl();
    urlInput.value = url;
  }
  
  // Validate URL
  if (!url || !isValidUrl(url)) {
    resultBox.textContent = 'Please enter a valid URL';
    resultBox.classList.add('show');
    resultBox.style.background = 'rgba(255, 59, 48, 0.1)';
    resultBox.style.borderColor = 'rgba(255, 59, 48, 0.3)';
    resultBox.style.color = '#ff453a';
    return;
  }
  
  // Disable button and show loading
  shortenBtn.disabled = true;
  shortenBtn.innerHTML = '<span class="loading"></span>';
  resultBox.classList.remove('show');
  
  try {
    const shortUrl = await shortenUrl(url);
    
    // Show result
    resultBox.textContent = shortUrl;
    resultBox.classList.add('show');
    resultBox.style.background = 'rgba(93, 176, 255, 0.1)';
    resultBox.style.borderColor = 'rgba(93, 176, 255, 0.3)';
    resultBox.style.color = '#5db0ff';
    
    // Add to history
    addToHistory(url, shortUrl);
    
    // Clear input
    urlInput.value = '';
    
  } catch (error) {
    resultBox.textContent = error.message;
    resultBox.classList.add('show');
    resultBox.style.background = 'rgba(255, 59, 48, 0.1)';
    resultBox.style.borderColor = 'rgba(255, 59, 48, 0.3)';
    resultBox.style.color = '#ff453a';
  } finally {
    shortenBtn.disabled = false;
    shortenBtn.textContent = 'Shorten';
  }
}

// Validate URL
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

// Event Listeners
shortenBtn.addEventListener('click', handleShorten);

urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    handleShorten();
  }
});

resultBox.addEventListener('click', async () => {
  if (resultBox.textContent && resultBox.textContent !== 'Click to copy') {
    const success = await copyToClipboard(resultBox.textContent);
    if (success) {
      const originalText = resultBox.textContent;
      resultBox.textContent = '✓ Copied!';
      setTimeout(() => {
        resultBox.textContent = originalText;
      }, 1500);
    }
  }
});

clearHistoryBtn.addEventListener('click', () => {
  if (confirm('Are you sure you want to clear all history?')) {
    history = [];
    saveHistory();
    renderHistory();
  }
});

// Auto-fill current tab URL on load
async function init() {
  loadHistory();
  const currentUrl = await getCurrentTabUrl();
  if (currentUrl) {
    urlInput.placeholder = `Current tab: ${currentUrl.substring(0, 40)}...`;
  }
}

// Initialize
init();