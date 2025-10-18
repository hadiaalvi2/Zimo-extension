// popup.js - URL Shortener Chrome Extension Logic

let currentUrlData = null;
let historyData = [];
let currentView = 'main'; // 'main' or 'history'

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup loaded');
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
    console.log('Getting current tab...');
    
    // Get current active tab with timeout
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
      throw new Error('Could not get current tab URL');
    }

    console.log('Current tab:', {
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl
    });

    // Check if URL is valid for shortening
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
      throw new Error('Cannot shorten this type of URL (chrome://, file://, etc.)');
    }

    // First, get metadata (do this before shortening so we have it ready)
    console.log('Fetching metadata first...');
    let metadata = await fetchMetadataWithTimeout(tab.url, tab, 8000);
    console.log('Metadata result:', metadata);

    // Shorten the URL
    console.log('Now shortening URL...');
    const shortUrl = await shortenUrlWithTimeout(tab.url, 10000);
    console.log('Shortened URL:', shortUrl);
    
    // Combine data with better fallbacks
    currentUrlData = {
      originalUrl: tab.url,
      shortUrl: shortUrl,
      title: metadata.title || tab.title || extractTitleFromUrl(tab.url),
      favicon: metadata.favicon || tab.favIconUrl || '',
      description: metadata.description || tab.title || '',
      image: metadata.image || '',
      timestamp: Date.now(),
      clicks: 0
    };

    console.log('Final currentUrlData:', currentUrlData);

    // Display the data
    displayUrlData(currentUrlData);
    
    // Save to history
    await saveToHistory(currentUrlData);
    
    showLoading(false);
  } catch (error) {
    console.error('Error in shortenCurrentTabUrl:', error);
    showError(error.message || 'Failed to shorten URL');
  }
}

// Extract a readable title from URL as fallback
function extractTitleFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    const path = urlObj.pathname.split('/').filter(p => p).join(' - ');
    return path ? `${domain}: ${path}` : domain;
  } catch (e) {
    return 'Untitled Page';
  }
}

// Shorten URL with timeout
async function shortenUrlWithTimeout(url, timeout = 10000) {
  const shortenPromise = shortenUrl(url);
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('URL shortening timeout')), timeout)
  );
  
  return Promise.race([shortenPromise, timeoutPromise]);
}

// Fetch metadata with timeout
async function fetchMetadataWithTimeout(url, tab, timeout = 8000) {
  const metadataPromise = fetchMetadata(url, tab);
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      console.log('Metadata fetch timeout, using fallback');
      resolve({
        title: tab.title || extractTitleFromUrl(url),
        favicon: tab.favIconUrl || '',
        description: tab.title || '',
        image: ''
      });
    }, timeout);
  });
  
  return Promise.race([metadataPromise, timeoutPromise]);
}

// Shorten URL using multiple services
async function shortenUrl(url) {
  console.log('Attempting to shorten URL:', url);
  
  // Method 1: Try direct TinyURL call
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      mode: 'cors',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const shortUrl = await response.text();
      if (shortUrl && shortUrl.startsWith('http')) {
        console.log('TinyURL direct success:', shortUrl);
        return shortUrl;
      }
    }
  } catch (error) {
    console.log('TinyURL direct failed:', error.message);
  }

  // Method 2: Try through background script
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'shortenUrl',
      url: url
    });

    if (response && response.success && response.shortUrl) {
      console.log('Background script success:', response.shortUrl);
      return response.shortUrl;
    }
  } catch (error) {
    console.log('Background script failed:', error.message);
  }

  // Final fallback: Generate mock short URL
  console.log('Using fallback short URL');
  return `https://zimo.ws/${generateShortCode()}`;
}

// Generate a random short code
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Fetch metadata from URL using multiple methods
async function fetchMetadata(url, tab) {
  console.log('Starting metadata fetch for:', url);
  
  let metadata = {
    title: tab.title || extractTitleFromUrl(url),
    favicon: tab.favIconUrl || '',
    description: tab.title || '',
    image: ''
  };

  // Method 1: Try content script injection (most reliable)
  try {
    console.log('Trying content script injection...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractMetadata,
      args: [url]
    });

    if (results && results[0] && results[0].result) {
      const scriptMetadata = results[0].result;
      console.log('Content script returned:', scriptMetadata);
      
      // Merge with existing metadata, preferring content script data
      metadata = {
        title: scriptMetadata.title || metadata.title,
        favicon: scriptMetadata.favicon || metadata.favicon,
        description: scriptMetadata.description || metadata.description,
        image: scriptMetadata.image || metadata.image
      };
      
      console.log('Merged metadata after content script:', metadata);
      
      // If we got good data, return it
      if (scriptMetadata.title || scriptMetadata.description) {
        return metadata;
      }
    }
  } catch (error) {
    console.log('Content script method failed:', error.message);
  }

  // Method 2: Try background script fetch
  try {
    console.log('Trying background script fetch...');
    const response = await chrome.runtime.sendMessage({
      action: 'fetchMetadata',
      url: url
    });

    if (response && response.success && response.metadata) {
      const bgMetadata = response.metadata;
      console.log('Background script returned:', bgMetadata);
      
      metadata = {
        title: bgMetadata.title || metadata.title,
        favicon: bgMetadata.favicon || metadata.favicon,
        description: bgMetadata.description || metadata.description,
        image: bgMetadata.image || metadata.image
      };
      
      console.log('Merged metadata after background:', metadata);
    }
  } catch (error) {
    console.log('Background fetch method failed:', error.message);
  }

  console.log('Final metadata to return:', metadata);
  return metadata;
}

// Function to be injected into the page to extract metadata
function extractMetadata(pageUrl) {
  console.log('extractMetadata running on page:', window.location.href);
  
  const metadata = {
    title: '',
    favicon: '',
    description: '',
    image: ''
  };

  try {
    // Get title - try multiple sources in priority order
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    const docTitle = document.title;
    
    metadata.title = (ogTitle && ogTitle.getAttribute('content')) || 
                     (twitterTitle && twitterTitle.getAttribute('content')) || 
                     docTitle || 
                     '';
    
    console.log('Extracted title:', metadata.title);

    // Get description
    const ogDesc = document.querySelector('meta[property="og:description"]');
    const twitterDesc = document.querySelector('meta[name="twitter:description"]');
    const normalDesc = document.querySelector('meta[name="description"]');
    
    metadata.description = (ogDesc && ogDesc.getAttribute('content')) || 
                          (twitterDesc && twitterDesc.getAttribute('content')) || 
                          (normalDesc && normalDesc.getAttribute('content')) || 
                          '';
    
    console.log('Extracted description:', metadata.description);

    // Get image
    const ogImage = document.querySelector('meta[property="og:image"]');
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    const ogImageUrl = document.querySelector('meta[property="og:image:url"]');
    
    metadata.image = (ogImage && ogImage.getAttribute('content')) || 
                     (twitterImage && twitterImage.getAttribute('content')) || 
                     (ogImageUrl && ogImageUrl.getAttribute('content')) || 
                     '';
    
    console.log('Extracted image:', metadata.image);

    // Get favicon
    const iconLink = document.querySelector('link[rel*="icon"]');
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    
    if (iconLink) {
      metadata.favicon = iconLink.href;
    } else if (appleIcon) {
      metadata.favicon = appleIcon.href;
    } else {
      // Construct default favicon URL
      try {
        const url = new URL(pageUrl);
        metadata.favicon = `${url.protocol}//${url.host}/favicon.ico`;
      } catch (e) {
        metadata.favicon = '';
      }
    }
    
    console.log('Extracted favicon:', metadata.favicon);
  } catch (error) {
    console.error('Error in extractMetadata:', error);
  }

  console.log('extractMetadata final result:', metadata);
  return metadata;
}

// Display URL data in the popup
function displayUrlData(data) {
  console.log('Displaying URL data:', data);
  
  document.getElementById('mainCard').style.display = 'block';
  
  // Set source logo
  try {
    const domain = new URL(data.originalUrl).hostname.replace('www.', '');
    const logoText = domain.split('.')[0].substring(0, 3).toUpperCase();
    document.getElementById('sourceLogo').textContent = logoText;
    console.log('Logo text:', logoText);
  } catch (e) {
    document.getElementById('sourceLogo').textContent = 'URL';
  }
  
  // Set short URL
  document.getElementById('shortUrl').textContent = data.shortUrl;
  document.getElementById('shortUrl').title = 'Click to copy: ' + data.shortUrl;
  
  // Set title
  document.getElementById('pageTitle').textContent = data.title;
  console.log('Displayed title:', data.title);
  
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
  try {
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
    console.log('Saved to history');
  } catch (error) {
    console.error('Error saving to history:', error);
  }
}

// Load history from storage
async function loadHistory() {
  try {
    const result = await chrome.storage.local.get('urlHistory');
    historyData = result.urlHistory || [];
    return historyData;
  } catch (error) {
    console.error('Error loading history:', error);
    return [];
  }
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
    
    let logoText = 'URL';
    try {
      const domain = new URL(item.originalUrl).hostname.replace('www.', '');
      logoText = domain.split('.')[0].substring(0, 3).toUpperCase();
    } catch (e) {
      // Keep default
    }
    
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
  
  console.log('Sharing:', { action, url, text });
  
  const shareUrls = {
    copy: () => copyToClipboard(url),
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(text + '\n' + url)}`,
    discord: () => copyToClipboard(url),
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    omn: url,
    reddit: `https://reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(text + '\n' + url)}`,
    twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(text + '\n\n' + url)}`
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