let currentUrlData = null;
let historyData = [];
let currentView = 'main';

// Initialize popup with better error handling
document.addEventListener('DOMContentLoaded', async () => {
  console.log('=== POPUP LOADED ===');
  
  try {
    console.log('Step 1: Loading history...');
    await loadHistory();
    console.log('History loaded successfully');
    
    console.log('Step 2: Setting up event listeners...');
    setupEventListeners();
    console.log('Event listeners set up successfully');
    
    console.log('Step 3: Shortening current tab URL...');
    await shortenCurrentTabUrl();
    console.log('URL shortening completed');
  } catch (error) {
    console.error('ERROR in DOMContentLoaded:', error);
    showError('Initialization error: ' + error.message);
  }
});

// Setup all event listeners
function setupEventListeners() {
  try {
    // Short URL click to copy
    const shortUrlEl = document.getElementById('shortUrl');
    if (shortUrlEl) {
      shortUrlEl.addEventListener('click', () => {
        copyToClipboard(currentUrlData?.shortUrl);
      });
    }

    // Share buttons
    document.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = e.currentTarget.getAttribute('data-action');
        handleShareAction(action);
      });
    });

    // Scroll navigation
    const shareActions = document.getElementById('shareActions');
    const scrollLeftBtn = document.getElementById('scrollLeft');
    const scrollRightBtn = document.getElementById('scrollRight');
    
    if (scrollLeftBtn && scrollRightBtn && shareActions) {
      scrollLeftBtn.addEventListener('click', () => {
        shareActions.scrollBy({ left: -150, behavior: 'smooth' });
      });
      scrollRightBtn.addEventListener('click', () => {
        shareActions.scrollBy({ left: 150, behavior: 'smooth' });
      });
      
      shareActions.addEventListener('scroll', updateScrollButtons);
      updateScrollButtons();
    }

    // History icon toggle
    const historyIcon = document.getElementById('historyIcon');
    if (historyIcon) {
      historyIcon.addEventListener('click', toggleView);
    }
    
    // QR Code functionality
    const qrBtn = document.getElementById('qrBtn');
    if (qrBtn) {
      qrBtn.addEventListener('click', () => {
        if (currentUrlData?.shortUrl) {
          showQRModal(currentUrlData.shortUrl);
        }
      });
    }
    
    console.log('All event listeners attached');
  } catch (error) {
    console.error('Error in setupEventListeners:', error);
  }
}

// Get current tab URL and shorten it
async function shortenCurrentTabUrl() {
  showLoading(true);
  
  try {
    console.log('Getting active tab...');
    
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('Tabs query result:', tabs);
    
    if (!tabs || tabs.length === 0) {
      throw new Error('No active tab found');
    }
    
    const tab = tabs[0];
    
    if (!tab.url) {
      throw new Error('Could not get tab URL');
    }

    console.log('Current tab info:', {
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl
    });

    // Check if URL is valid
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
      throw new Error('Cannot shorten this type of URL (chrome://, file://, etc.)');
    }

    // Get metadata using content script (most reliable method)
    console.log('Step 1: Fetching metadata...');
    let metadata = await extractMetadataFromCurrentTab(tab);
    console.log('Metadata fetched:', metadata);

    // Shorten URL
    console.log('Step 2: Shortening URL...');
    let shortUrl;
    try {
      shortUrl = await shortenUrlWithTimeout(tab.url, 10000);
      console.log('URL shortened successfully:', shortUrl);
    } catch (error) {
      console.error('Shortening failed, using fallback:', error);
      shortUrl = `https://zimo.ws/${generateShortCode()}`;
    }
    
    // Create final data object
    currentUrlData = {
      originalUrl: tab.url,
      shortUrl: shortUrl,
      title: metadata.title || tab.title || extractTitleFromUrl(tab.url),
      favicon: metadata.favicon || tab.favIconUrl || getFaviconFromUrl(tab.url),
      description: metadata.description || '',
      image: metadata.image || '',
      timestamp: Date.now(),
      clicks: 0
    };

    console.log('Final URL data:', currentUrlData);

    // Display and save
    displayUrlData(currentUrlData);
    await saveToHistory(currentUrlData);
    
    showLoading(false);
    console.log('=== SHORTENING COMPLETE ===');
  } catch (error) {
    console.error('ERROR in shortenCurrentTabUrl:', error);
    showError(error.message || 'Failed to process URL');
  }
}

// Extract metadata from current tab using content script
async function extractMetadataFromCurrentTab(tab) {
  console.log('Extracting metadata from current tab...');
  
  const metadata = {
    title: '',
    description: '',
    image: '',
    favicon: ''
  };

  try {
    // Execute content script in the current tab to extract metadata
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const getMetaContent = (name, property) => {
          const meta = document.querySelector(`meta[${property}="${name}"]`) || 
                      document.querySelector(`meta[name="${name}"]`);
          return meta ? meta.content : '';
        };

        const getLinkHref = (rel) => {
          const link = document.querySelector(`link[rel="${rel}"]`) ||
                      document.querySelector(`link[rel*="${rel}"]`);
          return link ? link.href : '';
        };

        // Extract title
        const ogTitle = getMetaContent('og:title', 'property');
        const twitterTitle = getMetaContent('twitter:title', 'name');
        const title = ogTitle || twitterTitle || document.title;

        // Extract description
        const ogDesc = getMetaContent('og:description', 'property');
        const twitterDesc = getMetaContent('twitter:description', 'name');
        const metaDesc = getMetaContent('description', 'name');
        const description = ogDesc || twitterDesc || metaDesc;

        // Extract image
        const ogImage = getMetaContent('og:image', 'property');
        const twitterImage = getMetaContent('twitter:image', 'name');
        const image = ogImage || twitterImage;

        // Extract favicon
        const favicon = getLinkHref('icon') || getLinkHref('shortcut icon') || 
                       getLinkHref('apple-touch-icon') || '/favicon.ico';

        // Make URLs absolute
        const makeAbsolute = (url) => {
          if (!url) return '';
          if (url.startsWith('http')) return url;
          if (url.startsWith('//')) return window.location.protocol + url;
          if (url.startsWith('/')) return window.location.origin + url;
          return window.location.origin + '/' + url;
        };

        return {
          title: title || '',
          description: description || '',
          image: makeAbsolute(image),
          favicon: makeAbsolute(favicon)
        };
      }
    });

    if (results && results[0] && results[0].result) {
      const extracted = results[0].result;
      console.log('Content script extraction result:', extracted);
      
      // Use extracted data if we got meaningful results
      if (extracted.title || extracted.description) {
        return extracted;
      }
    }
  } catch (error) {
    console.log('Content script extraction failed:', error.message);
    
    // Fallback to background script for CORS-enabled fetching
    try {
      console.log('Trying background script fallback...');
      const response = await chrome.runtime.sendMessage({
        action: 'fetchMetadata',
        url: tab.url,
        tabInfo: {
          title: tab.title,
          favIconUrl: tab.favIconUrl
        }
      });

      if (response && response.success && response.metadata) {
        console.log('Background script metadata:', response.metadata);
        return response.metadata;
      }
    } catch (bgError) {
      console.log('Background script also failed:', bgError.message);
    }
  }

  // Final fallback - use tab information
  console.log('Using tab info as fallback metadata');
  return {
    title: tab.title || '',
    description: '',
    image: '',
    favicon: tab.favIconUrl || getFaviconFromUrl(tab.url)
  };
}

// Extract favicon URL from domain
function getFaviconFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.host}/favicon.ico`;
  } catch (e) {
    return '';
  }
}

// Extract a readable title from URL
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
  return Promise.race([
    shortenUrl(url),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Shortening timeout')), timeout)
    )
  ]);
}

// Shorten URL
async function shortenUrl(url) {
  console.log('Shortening URL:', url);
  
  // Try background script first
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'shortenUrl',
      url: url
    });

    if (response && response.success && response.shortUrl) {
      console.log('Background success:', response.shortUrl);
      return response.shortUrl;
    }
  } catch (error) {
    console.log('Background failed:', error.message);
  }

  // Fallback
  return `https://zimo.ws/${generateShortCode()}`;
}

// Generate short code
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Display URL data
function displayUrlData(data) {
  console.log('Displaying data:', data);
  
  const mainCard = document.getElementById('mainCard');
  if (mainCard) {
    mainCard.style.display = 'block';
  }
  
  // Logo and favicon
  try {
    const domain = new URL(data.originalUrl).hostname.replace('www.', '');
    const logoText = domain.split('.')[0].substring(0, 3).toUpperCase();
    const logoEl = document.getElementById('sourceLogo');
    if (logoEl) logoEl.textContent = logoText;
    
    // Set favicon if available
    if (data.favicon) {
      const faviconEl = document.getElementById('pageFavicon');
      if (faviconEl) {
        faviconEl.src = data.favicon;
        faviconEl.style.display = 'block';
        faviconEl.onerror = function() {
          this.style.display = 'none';
        };
      }
    }
  } catch (e) {
    const logoEl = document.getElementById('sourceLogo');
    if (logoEl) logoEl.textContent = 'URL';
  }
  
  // Short URL
  const shortUrlEl = document.getElementById('shortUrl');
  if (shortUrlEl) {
    shortUrlEl.textContent = data.shortUrl;
    shortUrlEl.title = 'Click to copy: ' + data.shortUrl;
  }
  
  // Title
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = data.title;
  
  // Description (if available)
  if (data.description) {
    const descEl = document.getElementById('pageDescription');
    if (descEl) {
      descEl.textContent = data.description;
      descEl.style.display = 'block';
    }
  }
  
  // Original URL
  const originalEl = document.getElementById('originalUrl');
  if (originalEl) originalEl.textContent = data.originalUrl;
  
  // Timestamp
  const date = new Date(data.timestamp);
  const timeEl = document.getElementById('timeDisplay');
  const dateEl = document.getElementById('dateDisplay');
  if (timeEl) timeEl.textContent = formatTime(date);
  if (dateEl) dateEl.textContent = formatDate(date);
}

// Format time
function formatTime(date) {
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false 
  });
}

// Format date
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
    const existingIndex = historyData.findIndex(item => item.originalUrl === data.originalUrl);
    
    if (existingIndex !== -1) {
      historyData[existingIndex] = data;
    } else {
      historyData.unshift(data);
    }
    
    if (historyData.length > 50) {
      historyData = historyData.slice(0, 50);
    }
    
    await chrome.storage.local.set({ urlHistory: historyData });
    console.log('Saved to history');
  } catch (error) {
    console.error('Error saving history:', error);
  }
}

// Load history
async function loadHistory() {
  try {
    const result = await chrome.storage.local.get('urlHistory');
    historyData = result.urlHistory || [];
    console.log('Loaded history:', historyData.length, 'items');
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
  
  if (!historyList || !emptyHistory) return;
  
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
    } catch (e) {}
    
    const date = new Date(item.timestamp);
    
    card.innerHTML = `
      <div class="source-header">
        <div class="source-logo">${logoText}</div>
        <div class="source-info">
          <div class="short-url" data-url="${item.shortUrl}">${item.shortUrl}</div>
        </div>
      </div>
      <div class="page-title">${item.title}</div>
      ${item.description ? `<div class="page-description">${item.description}</div>` : ''}
      <div class="original-url">${item.originalUrl}</div>
      <div class="timestamp">
        <span>${formatTime(date)}</span>
        <span>${formatDate(date)}</span>
      </div>
      <div class="history-actions">
        <button class="history-action-btn" data-action="copy" data-index="${index}">
          <img src="assets/Share/Copy Icon W.svg" alt="Copy">
        </button>
        <button class="history-action-btn" data-action="open" data-index="${index}">
          <img src="assets/Share/OMN W.svg" alt="Open">
        </button>
        <button class="history-action-btn" data-action="qr" data-index="${index}">
          <img src="assets/Share/QR Code W.svg" alt="QR Code">
        </button>
        <button class="history-action-btn" data-action="delete" data-index="${index}">
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
  
  // Event listeners
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

// Handle history action
async function handleHistoryAction(action, index) {
  const item = historyData[index];
  
  switch (action) {
    case 'copy':
      copyToClipboard(item.shortUrl);
      break;
    case 'open':
      chrome.tabs.create({ url: item.shortUrl });
      break;
    case 'qr':
      showQRModal(item.shortUrl);
      break;
    case 'delete':
      historyData.splice(index, 1);
      await chrome.storage.local.set({ urlHistory: historyData });
      displayHistory();
      break;
  }
}

// Toggle view
function toggleView() {
  if (currentView === 'main') {
    currentView = 'history';
    const mainCard = document.getElementById('mainCard');
    const historyView = document.getElementById('historyView');
    const shareContainer = document.getElementById('shareContainer');
    
    if (mainCard) mainCard.style.display = 'none';
    if (historyView) historyView.style.display = 'block';
    if (shareContainer) shareContainer.style.display = 'none';
    displayHistory();
  } else {
    currentView = 'main';
    const mainCard = document.getElementById('mainCard');
    const historyView = document.getElementById('historyView');
    const shareContainer = document.getElementById('shareContainer');
    
    if (mainCard) mainCard.style.display = 'block';
    if (historyView) historyView.style.display = 'none';
    if (shareContainer) shareContainer.style.display = 'flex';
  }
}

// Handle share action
function handleShareAction(action) {
  if (!currentUrlData) return;
  
  const url = currentUrlData.shortUrl;
  const text = currentUrlData.title;
  
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
    console.error('Copy failed:', err);
  });
}

// Show copy feedback
function showCopyFeedback() {
  const feedback = document.createElement('div');
  feedback.className = 'copy-feedback';
  feedback.textContent = 'Copied!';
  document.body.appendChild(feedback);
  
  setTimeout(() => feedback.remove(), 2000);
}

// Update scroll buttons
function updateScrollButtons() {
  const shareActions = document.getElementById('shareActions');
  const scrollLeft = document.getElementById('scrollLeft');
  const scrollRight = document.getElementById('scrollRight');
  
  if (!shareActions || !scrollLeft || !scrollRight) return;
  
  scrollLeft.disabled = shareActions.scrollLeft <= 0;
  scrollRight.disabled = 
    shareActions.scrollLeft >= shareActions.scrollWidth - shareActions.clientWidth - 1;
}

// Show loading
function showLoading(show) {
  const loadingState = document.getElementById('loadingState');
  const errorState = document.getElementById('errorState');
  const mainCard = document.getElementById('mainCard');
  
  if (loadingState) loadingState.style.display = show ? 'block' : 'none';
  if (errorState) errorState.style.display = 'none';
  if (mainCard) mainCard.style.display = show ? 'none' : 'block';
}

// Show error
function showError(message) {
  console.error('Showing error:', message);
  
  const loadingState = document.getElementById('loadingState');
  const mainCard = document.getElementById('mainCard');
  const errorState = document.getElementById('errorState');
  
  if (loadingState) loadingState.style.display = 'none';
  if (mainCard) mainCard.style.display = 'none';
  if (errorState) {
    errorState.style.display = 'block';
    errorState.textContent = message;
  }
}

// QR Code Generator Function
function generateQRCode(text) {
  const size = 200;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  return qrApiUrl;
}

// QR Modal Function
function showQRModal(url) {
  const modal = document.createElement('div');
  modal.className = 'qr-modal';
  modal.innerHTML = `
    <div class="qr-modal-content">
      <div class="qr-modal-header">
        <h3>QR Code</h3>
        <button class="qr-close-btn">&times;</button>
      </div>
      <div class="qr-modal-body">
        <img src="${generateQRCode(url)}" alt="QR Code" class="qr-code-img">
        <p class="qr-url">${url}</p>
        <button class="qr-download-btn">Download QR Code</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  modal.querySelector('.qr-close-btn').addEventListener('click', () => {
    modal.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  modal.querySelector('.qr-download-btn').addEventListener('click', async () => {
    const qrUrl = generateQRCode(url);
    try {
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `qr-code-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download QR code. Please try right-clicking on the image and saving it.');
    }
  });
}