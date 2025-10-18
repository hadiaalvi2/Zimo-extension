// popup.js - URL Shortener Chrome Extension Logic

let currentUrlData = null;
let historyData = [];
let currentView = 'main'; // 'main' or 'history'

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  await loadHistory();
  await shortenCurrentTabUrl();
  setupEventListeners();
});

// Setup all event listeners
function setupEventListeners() {
  // Short URL click to copy
  document.getElementById('shortUrl').addEventListener('click', () => {
    copyToClipboard(currentUrlData?.shortUrl);
  });

  // Share buttons
  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.currentTarget.getAttribute('data-action');
      handleShareAction(action);
    });
  });

  // Scroll navigation
  const shareActions = document.getElementById('shareActions');
  document.getElementById('scrollLeft').addEventListener('click', () => {
    shareActions.scrollBy({ left: -150, behavior: 'smooth' });
  });
  document.getElementById('scrollRight').addEventListener('click', () => {
    shareActions.scrollBy({ left: 150, behavior: 'smooth' });
  });

  // History icon toggle
  document.getElementById('historyIcon').addEventListener('click', toggleView);

  // Update scroll buttons state
  shareActions.addEventListener('scroll', updateScrollButtons);
  updateScrollButtons();
}

// Get current tab URL and shorten it
async function shortenCurrentTabUrl() {
  showLoading(true);
  
  try {
    // Get current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
      throw new Error('Could not get current tab URL');
    }

    // Shorten the URL
    const shortUrl = await shortenUrl(tab.url);
    
    // Fetch metadata
    const metadata = await fetchMetadata(tab.url, tab);
    
    // Combine data
    currentUrlData = {
      originalUrl: tab.url,
      shortUrl: shortUrl,
      title: metadata.title || tab.title || 'Untitled',
      favicon: metadata.favicon || tab.favIconUrl || '',
      description: metadata.description || '',
      image: metadata.image || '',
      timestamp: Date.now(),
      clicks: 0
    };

    // Display the data
    displayUrlData(currentUrlData);
    
    // Save to history
    await saveToHistory(currentUrlData);
    
    showLoading(false);
  } catch (error) {
    console.error('Error:', error);
    showError(error.message || 'Failed to shorten URL');
  }
}

// Shorten URL using TinyURL API
async function shortenUrl(url) {
  try {
    // Using TinyURL API
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    
    if (!response.ok) {
      throw new Error('Failed to shorten URL');
    }
    
    const shortUrl = await response.text();
    return shortUrl;
  } catch (error) {
    console.error('Shortening error:', error);
    // Fallback to a mock shortened URL for demo
    return `zimo.ws/${generateShortCode()}`;
  }
}

// Generate a random short code for demo purposes
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Fetch metadata from URL
async function fetchMetadata(url, tab) {
  try {
    // Try to inject a content script to get metadata
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractMetadata
    });

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch (error) {
    console.error('Metadata extraction error:', error);
  }

  // Return basic metadata from tab info
  return {
    title: tab.title || 'Untitled',
    favicon: tab.favIconUrl || '',
    description: '',
    image: ''
  };
}

// Function to be injected into the page to extract metadata
function extractMetadata() {
  const metadata = {
    title: document.title,
    favicon: '',
    description: '',
    image: ''
  };

  // Get favicon
  const faviconLink = document.querySelector('link[rel~="icon"]') || 
                      document.querySelector('link[rel~="shortcut icon"]');
  if (faviconLink) {
    metadata.favicon = faviconLink.href;
  }

  // Get description
  const descMeta = document.querySelector('meta[name="description"]') ||
                   document.querySelector('meta[property="og:description"]');
  if (descMeta) {
    metadata.description = descMeta.content;
  }

  // Get image
  const imageMeta = document.querySelector('meta[property="og:image"]') ||
                    document.querySelector('meta[name="twitter:image"]');
  if (imageMeta) {
    metadata.image = imageMeta.content;
  }

  return metadata;
}

// Display URL data in the popup
function displayUrlData(data) {
  document.getElementById('mainCard').style.display = 'block';
  
  // Set source logo
  const domain = new URL(data.originalUrl).hostname.replace('www.', '');
  const logoText = domain.split('.')[0].substring(0, 3).toUpperCase();
  document.getElementById('sourceLogo').textContent = logoText;
  
  // Set short URL
  document.getElementById('shortUrl').textContent = data.shortUrl;
  document.getElementById('shortUrl').title = 'Click to copy: ' + data.shortUrl;
  
  // Set title
  document.getElementById('pageTitle').textContent = data.title;
  
  // Set original URL
  document.getElementById('originalUrl').textContent = data.originalUrl;
  
  // Set timestamp
  const date = new Date(data.timestamp);
  document.getElementById('timeDisplay').textContent = formatTime(date);
  document.getElementById('dateDisplay').textContent = formatDate(date);
}

// Format time (HH:MM)
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

// Format date (DD Month YYYY)
function formatDate(date) {
  return date.toLocaleDateString('en-GB', { 
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  });
}

// Save to history
async function saveToHistory(data) {
  historyData = await loadHistory();
  
  // Check if URL already exists
  const existingIndex = historyData.findIndex(item => item.originalUrl === data.originalUrl);
  
  if (existingIndex !== -1) {
    // Update existing entry
    historyData[existingIndex] = data;
  } else {
    // Add new entry at the beginning
    historyData.unshift(data);
  }
  
  // Keep only last 50 items
  if (historyData.length > 50) {
    historyData = historyData.slice(0, 50);
  }
  
  // Save to storage
  await chrome.storage.local.set({ urlHistory: historyData });
}

// Load history from storage
async function loadHistory() {
  const result = await chrome.storage.local.get('urlHistory');
  historyData = result.urlHistory || [];
  return historyData;
}

// Display history
function displayHistory() {
  const historyList = document.getElementById('historyList');
  const emptyHistory = document.getElementById('emptyHistory');
  
  historyList.innerHTML = '';
  
  if (historyData.length === 0) {
    emptyHistory.style.display = 'block';
    return;
  }
  
  emptyHistory.style.display = 'none';
  
  historyData.forEach((item, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'history-item-wrapper';
    
    const line = document.createElement('div');
    line.className = 'history-line';
    wrapper.appendChild(line);
    
    const card = document.createElement('div');
    card.className = 'card';
    
    const domain = new URL(item.originalUrl).hostname.replace('www.', '');
    const logoText = domain.split('.')[0].substring(0, 3).toUpperCase();
    
    const date = new Date(item.timestamp);
    
    card.innerHTML = `
      <div class="source-header">
        <div class="source-logo">${logoText}</div>
        <div class="source-info">
          <div class="short-url" data-url="${item.shortUrl}" title="Click to copy">${item.shortUrl}</div>
        </div>
      </div>
      <div class="page-title">${item.title}</div>
      <div class="original-url">${item.originalUrl}</div>
      <div class="timestamp">
        <span>${formatTime(date)}</span>
        <span>${formatDate(date)}</span>
      </div>
      <div class="history-actions">
        <button class="history-action-btn" data-action="copy" data-index="${index}" title="Copy">
          <img src="assets/Share/Copy Icon W.svg" alt="Copy">
        </button>
        <button class="history-action-btn" data-action="open" data-index="${index}" title="Open">
          <img src="assets/Share/OMN W.svg" alt="Open">
        </button>
        <button class="history-action-btn" data-action="delete" data-index="${index}" title="Delete">
          <img src="assets/Share/X W.svg" alt="Delete">
        </button>
        <div class="history-clicks">
          <img src="assets/Extension+/Chrome Extension Icon.svg" alt="Clicks">
          <span>${item.clicks || 0}</span>
        </div>
      </div>
    `;
    
    wrapper.appendChild(card);
    historyList.appendChild(wrapper);
  });
  
  // Add event listeners to history items
  document.querySelectorAll('.history-item-wrapper .short-url').forEach(el => {
    el.addEventListener('click', (e) => {
      copyToClipboard(e.target.getAttribute('data-url'));
    });
  });
  
  document.querySelectorAll('.history-action-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const action = e.currentTarget.getAttribute('data-action');
      const index = parseInt(e.currentTarget.getAttribute('data-index'));
      await handleHistoryAction(action, index);
    });
  });
}

// Handle history actions
async function handleHistoryAction(action, index) {
  const item = historyData[index];
  
  switch (action) {
    case 'copy':
      copyToClipboard(item.shortUrl);
      break;
    case 'open':
      chrome.tabs.create({ url: item.shortUrl });
      break;
    case 'delete':
      historyData.splice(index, 1);
      await chrome.storage.local.set({ urlHistory: historyData });
      displayHistory();
      break;
  }
}

// Toggle between main and history view
function toggleView() {
  if (currentView === 'main') {
    currentView = 'history';
    document.getElementById('mainCard').style.display = 'none';
    document.getElementById('historyView').style.display = 'block';
    document.getElementById('shareContainer').style.display = 'none';
    displayHistory();
  } else {
    currentView = 'main';
    document.getElementById('mainCard').style.display = 'block';
    document.getElementById('historyView').style.display = 'none';
    document.getElementById('shareContainer').style.display = 'flex';
  }
}

// Handle share actions
function handleShareAction(action) {
  if (!currentUrlData) return;
  
  const url = currentUrlData.shortUrl;
  const text = currentUrlData.title;
  
  const shareUrls = {
    copy: () => copyToClipboard(url),
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(text + ' ' + url)}`,
    discord: () => copyToClipboard(url), // Discord doesn't have direct share URL
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    omn: url, // Open the URL directly
    reddit: `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(text + ' ' + url)}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`
  };
  
  if (action === 'copy' || action === 'discord') {
    shareUrls[action]();
  } else if (action === 'omn') {
    chrome.tabs.create({ url: shareUrls[action] });
  } else {
    chrome.tabs.create({ url: shareUrls[action] });
  }
}

// Copy to clipboard
function copyToClipboard(text) {
  if (!text) return;
  
  navigator.clipboard.writeText(text).then(() => {
    showCopyFeedback();
  }).catch(err => {
    console.error('Failed to copy:', err);
  });
}

// Show copy feedback
function showCopyFeedback() {
  const feedback = document.createElement('div');
  feedback.className = 'copy-feedback';
  feedback.textContent = 'Copied to clipboard!';
  document.body.appendChild(feedback);
  
  setTimeout(() => {
    feedback.remove();
  }, 2000);
}

// Update scroll button states
function updateScrollButtons() {
  const shareActions = document.getElementById('shareActions');
  const scrollLeft = document.getElementById('scrollLeft');
  const scrollRight = document.getElementById('scrollRight');
  
  scrollLeft.disabled = shareActions.scrollLeft <= 0;
  scrollRight.disabled = 
    shareActions.scrollLeft >= shareActions.scrollWidth - shareActions.clientWidth - 1;
}

// Show/hide loading state
function showLoading(show) {
  document.getElementById('loadingState').style.display = show ? 'block' : 'none';
  document.getElementById('errorState').style.display = 'none';
  document.getElementById('mainCard').style.display = show ? 'none' : 'block';
}

// Show error state
function showError(message) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('mainCard').style.display = 'none';
  document.getElementById('errorState').style.display = 'block';
  document.getElementById('errorState').textContent = message;
}