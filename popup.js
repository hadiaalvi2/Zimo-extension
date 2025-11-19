
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
    // Short URL click to OPEN (not copy)
    const shortUrlEl = document.getElementById('shortUrl');
    if (shortUrlEl) {
      shortUrlEl.addEventListener('click', () => {
        if (currentUrlData?.shortUrl) {
          chrome.tabs.create({ url: currentUrlData.shortUrl });
        }
      });
      shortUrlEl.title = 'Click to open shortened link';
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
      // Get original buttons
      const originalButtons = Array.from(shareActions.querySelectorAll('.share-btn'));
      
      // Add 50 buttons at the END (for scrolling right)
      for (let i = 0; i < 50; i++) {
        const btn = originalButtons[i % originalButtons.length];
        const clone = btn.cloneNode(true);
        clone.addEventListener('click', (e) => {
          const action = clone.getAttribute('data-action');
          handleShareAction(action);
        });
        shareActions.appendChild(clone);
      }
      
      // Add 50 buttons at the BEGINNING (for scrolling left) - IN REVERSE to maintain order
      for (let i = 49; i >= 0; i--) {
        const btn = originalButtons[i % originalButtons.length];
        const clone = btn.cloneNode(true);
        clone.addEventListener('click', (e) => {
          const action = clone.getAttribute('data-action');
          handleShareAction(action);
        });
        shareActions.insertBefore(clone, shareActions.firstChild);
      }
      
      // Start in the MIDDLE
      setTimeout(() => {
        const middlePosition = shareActions.scrollWidth / 2 - shareActions.clientWidth / 2;
        shareActions.scrollLeft = middlePosition;
      }, 100);
      
      // Simple scroll
      scrollLeftBtn.addEventListener('click', () => {
        shareActions.scrollBy({ left: -150, behavior: 'smooth' });
      });
      
      scrollRightBtn.addEventListener('click', () => {
        shareActions.scrollBy({ left: 150, behavior: 'smooth' });
      });
      
      // Never disable buttons
      scrollLeftBtn.disabled = false;
      scrollRightBtn.disabled = false;
    }

    // History icon toggle
    const historyIcon = document.getElementById('historyIcon');
    if (historyIcon) {
      historyIcon.addEventListener('click', toggleView);
    }
    
    // Main card action buttons
    const mainOpenBtn = document.getElementById('mainOpenBtn');
    const mainCopyBtn = document.getElementById('mainCopyBtn');
    const mainShareBtn = document.getElementById('mainShareBtn');
    const mainDeleteBtn = document.getElementById('mainDeleteBtn');
    
    if (mainOpenBtn) {
      mainOpenBtn.addEventListener('click', () => {
        if (currentUrlData?.shortUrl) {
          chrome.tabs.create({ url: currentUrlData.shortUrl });
        }
      });
    }
    
    if (mainCopyBtn) {
      mainCopyBtn.addEventListener('click', () => {
        if (currentUrlData?.shortUrl) {
          copyToClipboard(currentUrlData.shortUrl);
        }
      });
    }
    
    if (mainShareBtn) {
      mainShareBtn.addEventListener('click', () => {
        if (currentUrlData?.shortUrl) {
          showQRModal(currentUrlData.shortUrl);
        }
      });
    }
    
    if (mainDeleteBtn) {
      mainDeleteBtn.addEventListener('click', async () => {
        if (currentUrlData) {
          // Find and remove from history
          const index = historyData.findIndex(item => item.originalUrl === currentUrlData.originalUrl);
          if (index !== -1) {
            historyData.splice(index, 1);
            await chrome.storage.local.set({ urlHistory: historyData });
            showCopyFeedback('Deleted from history');
          }
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

    // Check if URL is valid - only allow http and https
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
      showLoading(false);
      showError('Cannot shorten this type of URL (chrome://, file://, etc.)');
      return;
    }

    // Check if this URL was already shortened
    const existingIndex = historyData.findIndex(item => item.originalUrl === tab.url);
    let shortenCount = 1;
    
    if (existingIndex !== -1) {
      // URL exists, increment the count
      shortenCount = (historyData[existingIndex].clicks || 0) + 1;
      console.log(`URL already shortened ${shortenCount} times`);
    }

    // Shorten URL FIRST (parallel with metadata)
    console.log('Starting parallel operations...');
    
    const [shortUrl, metadata] = await Promise.all([
      shortenUrlWithTimeout(tab.url, 8000).catch(err => {
        console.error('Shortening failed:', err);
        return tab.url; // Fallback to original
      }),
      extractMetadataOptimized(tab).catch(err => {
        console.error('Metadata failed:', err);
        return {
          title: tab.title || extractTitleFromUrl(tab.url),
          description: '',
          image: '',
          favicon: tab.favIconUrl || getFaviconFromUrl(tab.url)
        };
      })
    ]);
    
    console.log('Parallel operations complete:', { shortUrl, metadata });
    
    // Create final data object with updated click count
    currentUrlData = {
      originalUrl: tab.url,
      shortUrl: shortUrl,
      title: metadata.title || tab.title || extractTitleFromUrl(tab.url),
      favicon: metadata.favicon || tab.favIconUrl || getFaviconFromUrl(tab.url),
      description: metadata.description || '',
      image: metadata.image || '',
      timestamp: Date.now(),
      clicks: shortenCount
    };

    console.log('Final URL data:', currentUrlData);

    // Display and save
    displayUrlData(currentUrlData);
    await saveToHistory(currentUrlData);
    
    showLoading(false);
    console.log('=== SHORTENING COMPLETE ===');
  } catch (error) {
    console.error('ERROR in shortenCurrentTabUrl:', error);
    showLoading(false);
    showError(error.message || 'Failed to process URL');
  }
}

// Optimized metadata extraction with priority-based fallback
async function extractMetadataOptimized(tab) {
  console.log('Starting optimized metadata extraction...');
  
  const defaultMetadata = {
    title: tab.title || extractTitleFromUrl(tab.url),
    description: '',
    image: '',
    favicon: tab.favIconUrl || getFaviconFromUrl(tab.url)
  };

  // Method 1: Content Script (Most Reliable - Direct DOM Access)
  try {
    console.log('Method 1: Trying content script execution...');
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractMetadataFromPage
    });

    if (results && results[0] && results[0].result) {
      const extracted = results[0].result;
      console.log('Content script SUCCESS:', extracted);
      
      if (extracted.title || extracted.description || extracted.image || extracted.favicon) {
        return {
          title: extracted.title || defaultMetadata.title,
          description: extracted.description || '',
          image: extracted.image || '',
          favicon: extracted.favicon || defaultMetadata.favicon
        };
      }
    }
  } catch (error) {
    console.log('Content script failed:', error.message);
  }

  // Method 2: Background Script with CORS Proxy
  try {
    console.log('Method 2: Trying background script with CORS proxy...');
    const response = await Promise.race([
      chrome.runtime.sendMessage({
        action: 'fetchMetadata',
        url: tab.url,
        tabInfo: {
          title: tab.title,
          favIconUrl: tab.favIconUrl
        }
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 6000)
      )
    ]);

    if (response && response.success && response.metadata) {
      console.log('Background script SUCCESS:', response.metadata);
      return {
        title: response.metadata.title || defaultMetadata.title,
        description: response.metadata.description || '',
        image: response.metadata.image || '',
        favicon: response.metadata.favicon || defaultMetadata.favicon
      };
    }
  } catch (error) {
    console.log('Background script failed:', error.message);
  }

  // Fallback: Use tab data
  console.log('Using tab data as fallback');
  return defaultMetadata;
}

// Function injected into page for metadata extraction
function extractMetadataFromPage() {
  const meta = {
    title: '',
    favicon: '',
    description: '',
    image: ''
  };

  try {
    // Title - priority: OG Title > Twitter Title > Document Title > H1
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const twitterTitle = document.querySelector('meta[name="twitter:title"]')?.content;
    const documentTitle = document.title;
    const h1Title = document.querySelector('h1')?.textContent?.trim();
    
    meta.title = ogTitle || twitterTitle || documentTitle || h1Title || '';
    
    // Description - priority: OG > Meta Description > Twitter > First Paragraph
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content;
    const metaDesc = document.querySelector('meta[name="description"]')?.content;
    const twitterDesc = document.querySelector('meta[name="twitter:description"]')?.content;
    
    let firstParaDesc = '';
    const paragraphs = document.querySelectorAll('p');
    for (let p of paragraphs) {
      const text = p.textContent?.trim();
      if (text && text.length > 20 && text.length < 300) {
        firstParaDesc = text;
        break;
      }
    }
    
    meta.description = ogDesc || metaDesc || twitterDesc || firstParaDesc || '';
    meta.description = meta.description.substring(0, 300);
    
    // Image - priority: OG Image > Twitter Image > First Large Image
    const ogImage = document.querySelector('meta[property="og:image"]')?.content;
    const twitterImage = document.querySelector('meta[name="twitter:image"]')?.content;
    
    meta.image = ogImage || twitterImage || '';
    
    // If no meta image, find first suitable image
    if (!meta.image) {
      const images = document.querySelectorAll('img[src]');
      for (let img of images) {
        const src = img.src;
        if (src && !src.includes('pixel') && !src.includes('track') && 
            !src.includes('icon') && !src.includes('logo') && !src.includes('avatar')) {
          const width = img.naturalWidth || img.offsetWidth || 0;
          const height = img.naturalHeight || img.offsetHeight || 0;
          if (width > 100 && height > 100) {
            meta.image = src;
            break;
          }
        }
      }
    }
    
    // Favicon - Dynamic extraction with multiple sources
    let faviconUrl = '';
    
    const iconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',
      'link[rel="mask-icon"]'
    ];
    
    for (let selector of iconSelectors) {
      const link = document.querySelector(selector);
      if (link?.href) {
        faviconUrl = link.href;
        break;
      }
    }
    
    if (!faviconUrl) {
      faviconUrl = window.location.origin + '/favicon.ico';
    }
    
    meta.favicon = faviconUrl;
    
    // Clean up whitespace
    meta.title = meta.title.trim();
    meta.description = meta.description.trim();
    
  } catch (e) {
    console.error('Extract error:', e);
  }

  return meta;
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
async function shortenUrlWithTimeout(url, timeout = 8000) {
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

  // Return original URL if shortening fails
  return url;
}

// Display URL data
function displayUrlData(data) {
  console.log('Displaying data:', data);
  
  const mainCard = document.getElementById('mainCard');
  if (mainCard) {
    mainCard.style.display = 'block';
  }
  
  try {
    const domain = new URL(data.originalUrl).hostname.replace('www.', '');
    const logoText = domain.split('.')[0].substring(0, 3).toUpperCase();
    const logoEl = document.getElementById('sourceLogo');
    if (logoEl) logoEl.textContent = logoText;
  } catch (e) {
    const logoEl = document.getElementById('sourceLogo');
    if (logoEl) logoEl.textContent = 'URL';
  }
  
  const shortUrlEl = document.getElementById('shortUrl');
  if (shortUrlEl) {
    shortUrlEl.textContent = data.shortUrl;
    shortUrlEl.title = 'Click to open: ' + data.shortUrl;
  }
  
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = data.title;
  
  const originalEl = document.getElementById('originalUrl');
  if (originalEl) originalEl.textContent = data.originalUrl;
  
  const date = new Date(data.timestamp);
  const timeEl = document.getElementById('timeDisplay');
  const dateEl = document.getElementById('dateDisplay');
  if (timeEl) timeEl.textContent = formatTime(date);
  if (dateEl) dateEl.textContent = formatDate(date);
  
  // Update clicks count - shows how many times this URL was shortened
  const clicksCountEl = document.getElementById('mainClicksCount');
  if (clicksCountEl) clicksCountEl.textContent = data.clicks || 1;
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
      // Update existing entry with new click count and timestamp
      historyData[existingIndex] = {
        ...historyData[existingIndex],
        clicks: data.clicks,
        timestamp: data.timestamp,
        shortUrl: data.shortUrl,
        title: data.title,
        description: data.description,
        image: data.image,
        favicon: data.favicon
      };
      console.log(`Updated existing URL. Shortened ${data.clicks} times`);
    } else {
      // Add new entry
      historyData.unshift(data);
      console.log('Added new URL to history');
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
        <button class="history-action-btn" data-action="copy" data-index="${index}" title="Copy URL">
          <img src="assets/Share/Copy Icon W.svg" alt="Copy">
        </button>
        <button class="history-action-btn" data-action="qr" data-index="${index}" title="Show QR Code">
          <img src="assets/Share W.svg" alt="Share">
        </button>
        <button class="history-action-btn" data-action="open" data-index="${index}" title="Open in new tab">
          <img src="assets/Open in New Window W.svg" alt="Open">
        </button>
        <button class="history-action-btn" data-action="delete" data-index="${index}" title="Delete">
          <img src="assets/Delete Icon W.svg" alt="Delete">
        </button>
        <div class="history-clicks" title="Times shortened">
          <img src="assets/Counter - URL Clicks W.svg" alt="Clicks">
          <span>${item.clicks || 1}</span>
        </div>
      </div>
    `;
    
    wrapper.appendChild(card);
    historyList.appendChild(wrapper);
  });
  
  // Make short URL clickable - OPENS link instead of copying
  document.querySelectorAll('.history-item-wrapper .short-url').forEach(el => {
    el.addEventListener('click', (e) => {
      const url = e.target.getAttribute('data-url');
      chrome.tabs.create({ url: url });
    });
  });
  
  // Add event listeners to history action buttons
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
      // Copy the shortened URL
      copyToClipboard(item.shortUrl);
      break;
    case 'open':
      // Open https://zimo.ws/ in new tab
      chrome.tabs.create({ url: 'https://zimo.ws/' });
      break;
    case 'qr':
      // Show QR code modal (share)
      showQRModal(item.shortUrl);
      break;
    case 'delete':
      // Delete from history
      historyData.splice(index, 1);
      await chrome.storage.local.set({ urlHistory: historyData });
      displayHistory();
      showCopyFeedback('Deleted from history');
      break;
  }
}

// Toggle view
function toggleView() {
  const recentLabel = document.getElementById('recentLabel');
  
  if (currentView === 'main') {
    currentView = 'history';
    const mainCard = document.getElementById('mainCard');
    const historyView = document.getElementById('historyView');
    const shareContainer = document.getElementById('shareContainer');
    
    if (mainCard) mainCard.style.display = 'none';
    if (historyView) historyView.style.display = 'block';
    if (shareContainer) shareContainer.style.display = 'none';
    if (recentLabel) recentLabel.classList.add('show');
    displayHistory();
  } else {
    currentView = 'main';
    const mainCard = document.getElementById('mainCard');
    const historyView = document.getElementById('historyView');
    const shareContainer = document.getElementById('shareContainer');
    
    if (mainCard) mainCard.style.display = 'block';
    if (historyView) historyView.style.display = 'none';
    if (shareContainer) shareContainer.style.display = 'flex';
    if (recentLabel) recentLabel.classList.remove('show');
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
function showCopyFeedback(message = 'Copied!') {
  const feedback = document.createElement('div');
  feedback.className = 'copy-feedback';
  feedback.textContent = message;
  document.body.appendChild(feedback);
  
  setTimeout(() => feedback.remove(), 2000);
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

// QR Code Generator
function generateQRCode(text) {
  const size = 200;
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}

// QR Modal
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
  
  // Add QR modal styles
  const style = document.createElement('style');
  style.textContent = `
    .qr-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }
    .qr-modal-content {
      background: rgba(40, 40, 40, 0.95);
      border-radius: 12px;
      padding: 20px;
      max-width: 300px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    .qr-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .qr-modal-header h3 {
      margin: 0;
      color: white;
      font-size: 16px;
    }
    .qr-close-btn {
      background: none;
      border: none;
      color: white;
      font-size: 24px;
      cursor: pointer;
      line-height: 1;
      padding: 0;
      width: 24px;
      height: 24px;
    }
    .qr-modal-body {
      text-align: center;
    }
    .qr-code-img {
      width: 200px;
      height: 200px;
      margin-bottom: 12px;
      background: white;
      padding: 10px;
      border-radius: 8px;
    }
    .qr-url {
      color: rgba(255, 255, 255, 0.7);
      font-size: 11px;
      word-break: break-all;
      margin-bottom: 16px;
    }
    .qr-download-btn {
      background: #5db0ff;
      border: none;
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    .qr-download-btn:hover {
      background: #7dc3ff;
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(modal);
  
  modal.querySelector('.qr-close-btn').addEventListener('click', () => {
    modal.remove();
    style.remove();
  });
  
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
      style.remove();
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
      alert('Failed to download QR code. Please try right-clicking and saving.');
    }
  });
}