const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const mainCard = document.getElementById('mainCard');
const historyView = document.getElementById('historyView');
const historyList = document.getElementById('historyList');
const emptyHistory = document.getElementById('emptyHistory');
const historyIcon = document.getElementById('historyIcon');
const shortUrlEl = document.getElementById('shortUrl');
const pageTitleEl = document.getElementById('pageTitle');
const originalUrlEl = document.getElementById('originalUrl');
const timeDisplay = document.getElementById('timeDisplay');
const dateDisplay = document.getElementById('dateDisplay');
const sourceLogoEl = document.getElementById('sourceLogo');
const shareActions = document.getElementById('shareActions');
const scrollLeftBtn = document.getElementById('scrollLeft');
const scrollRightBtn = document.getElementById('scrollRight');
const shareContainer = document.getElementById('shareContainer');

let currentShortUrl = '';
let currentPageTitle = '';
let currentOriginalUrl = '';
let currentMetadata = {};
let isHistoryView = false;
let metadataCache = {};

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    await loadMetadataCache();
    await shortenCurrentTab();
    setupEventListeners();
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize extension');
  }
}

// Load metadata cache from storage
async function loadMetadataCache() {
  try {
    const result = await chrome.storage.local.get(['metadataCache']);
    metadataCache = result.metadataCache || {};
    console.log('Loaded metadata cache:', Object.keys(metadataCache).length, 'entries');
  } catch (error) {
    console.error('Error loading cache:', error);
  }
}

// Save metadata to cache
async function saveMetadataToCache(url, metadata) {
  try {
    metadataCache[url] = {
      ...metadata,
      cachedAt: Date.now()
    };
    
    // Keep cache size manageable (max 200 entries)
    const keys = Object.keys(metadataCache);
    if (keys.length > 200) {
      const sorted = keys.sort((a, b) => 
        (metadataCache[a].cachedAt || 0) - (metadataCache[b].cachedAt || 0)
      );
      sorted.slice(0, 50).forEach(k => delete metadataCache[k]);
    }
    
    await chrome.storage.local.set({ metadataCache });
  } catch (error) {
    console.error('Error saving to cache:', error);
  }
}

// Get current tab info
async function getCurrentTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  } catch (error) {
    console.error('Error getting tab:', error);
    return null;
  }
}

// Fetch metadata with cache and timeout
async function fetchPageMetadataFromUrl(url, useCache = true) {
  try {
    // Check cache first
    if (useCache && metadataCache[url]) {
      console.log('Using cached metadata for:', url);
      return metadataCache[url];
    }

    console.log('Fetching metadata from:', url);
    
    // Set timeout for fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(url, { 
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
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

    // Get favicon - optimized
    let favicon = getMetaContent([
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]'
    ]);

    if (favicon && !favicon.startsWith('http')) {
      try {
        favicon = new URL(favicon, url).href;
      } catch (e) {
        favicon = new URL(url).origin + (favicon.startsWith('/') ? favicon : '/' + favicon);
      }
    }

    if (!favicon) {
      favicon = new URL(url).origin + '/favicon.ico';
    }

    // Get title
    const title = getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]'
    ]) || doc.querySelector('title')?.textContent || 'Untitled Page';

    // Get description
    const description = getMetaContent([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]'
    ]);

    // Get site name
    const siteName = getMetaContent([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]'
    ]);

    // Get image
    const image = getMetaContent([
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]'
    ]);

    const metadata = {
      title: title.trim(),
      description: description?.trim() || '',
      siteName: siteName?.trim() || '',
      image: image || '',
      favicon: favicon
    };

    // Cache the metadata
    await saveMetadataToCache(url, metadata);
    console.log('Fetched and cached metadata:', metadata);
    
    return metadata;
  } catch (error) {
    console.error('Error fetching metadata from URL:', error.message);
    return null;
  }
}

// Fetch page title using content script (faster fallback)
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

    return results?.[0]?.result || 'Untitled Page';
  } catch (error) {
    console.error('Error fetching page title:', error);
    return 'Untitled Page';
  }
}

// Extract domain name for logo
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const parts = hostname.split('.');
    
    if (parts.length > 2) {
      return parts[parts.length - 2].toUpperCase().substring(0, 3);
    } else if (parts.length >= 1) {
      return parts[0].toUpperCase().substring(0, 3);
    }
    return 'URL';
  } catch (error) {
    return 'URL';
  }
}

// Shorten URL using multiple services
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
      console.log(`Trying ${service.name}...`);
      const response = await fetch(service.url, {
        method: service.method,
        headers: {
          'Accept': 'text/plain'
        }
      });

      if (response.ok) {
        const shortUrl = await response.text();
        if (shortUrl && !shortUrl.includes('Error') && shortUrl.startsWith('http')) {
          console.log(`✓ ${service.name} success:`, shortUrl);
          return shortUrl.trim();
        }
      }
    } catch (error) {
      console.error(`${service.name} failed:`, error);
    }
  }

  throw new Error('All URL shortening services failed. Please try again later.');
}

// Main function to shorten current tab
async function shortenCurrentTab() {
  try {
    showLoading();
    
    const tab = await getCurrentTab();
    if (!tab || !tab.url) {
      throw new Error('Could not get current tab URL');
    }

    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
      throw new Error('Cannot shorten this type of URL');
    }

    currentOriginalUrl = tab.url;
    
    // Fetch metadata with timeout
    let metadata = await fetchPageMetadataFromUrl(currentOriginalUrl);
    
    if (!metadata || !metadata.title) {
      currentPageTitle = await fetchPageTitle(tab.id);
      currentMetadata = metadata || {};
    } else {
      currentPageTitle = metadata.title || tab.title || 'Untitled Page';
      currentMetadata = metadata;
    }
    
    console.log('Using metadata:', currentMetadata);
    
    // Shorten URL
    currentShortUrl = await shortenUrl(currentOriginalUrl);
    
    const domain = extractDomain(currentOriginalUrl);
    displayResult(currentShortUrl, currentPageTitle, currentOriginalUrl, domain, currentMetadata);
    
    await saveToHistory(currentOriginalUrl, currentShortUrl, currentPageTitle, currentMetadata);
    
  } catch (error) {
    console.error('Error:', error);
    showError(error.message || 'Failed to shorten URL');
  }
}

// Update date and time display
function updateDateTime() {
  const now = new Date();
  
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  timeDisplay.textContent = `${hours}:${minutes}`;
  
  const day = String(now.getDate()).padStart(2, '0');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  dateDisplay.textContent = `${day} ${month} ${year}`;
}

// Show loading state
function showLoading() {
  loadingState.style.display = 'block';
  errorState.style.display = 'none';
  mainCard.style.display = 'none';
  historyView.style.display = 'none';
  shareContainer.style.display = 'none';
}

// Show error state
function showError(message) {
  loadingState.style.display = 'none';
  errorState.style.display = 'block';
  errorState.textContent = message;
  mainCard.style.display = 'none';
  historyView.style.display = 'none';
  shareContainer.style.display = 'none';
}

// Display result
function displayResult(shortUrl, title, originalUrl, domain, metadata) {
  loadingState.style.display = 'none';
  errorState.style.display = 'none';
  mainCard.style.display = 'block';
  historyView.style.display = 'none';
  shareContainer.style.display = 'flex';
  isHistoryView = false;
  
  shortUrlEl.textContent = shortUrl;
  pageTitleEl.textContent = title;
  pageTitleEl.title = title;
  originalUrlEl.textContent = originalUrl;
  originalUrlEl.title = originalUrl;
  
  if (metadata && metadata.favicon) {
    displayFaviconLogo(metadata.favicon, domain);
  } else {
    displayTextLogo(domain);
  }
}

// Display favicon logo with error handling
function displayFaviconLogo(faviconUrl, domain) {
  const img = new Image();
  const timeout = setTimeout(() => {
    displayTextLogo(domain);
  }, 3000);
  
  img.onload = () => {
    clearTimeout(timeout);
    sourceLogoEl.innerHTML = '';
    sourceLogoEl.style.background = '#ffffff';
    sourceLogoEl.style.padding = '4px';
    sourceLogoEl.style.display = 'flex';
    sourceLogoEl.style.alignItems = 'center';
    sourceLogoEl.style.justifyContent = 'center';
    
    const faviconImg = document.createElement('img');
    faviconImg.src = faviconUrl;
    faviconImg.style.width = '100%';
    faviconImg.style.height = '100%';
    faviconImg.style.objectFit = 'contain';
    faviconImg.onerror = () => displayTextLogo(domain);
    
    sourceLogoEl.appendChild(faviconImg);
  };
  
  img.onerror = () => {
    clearTimeout(timeout);
    displayTextLogo(domain);
  };
  
  img.src = faviconUrl;
}

// Display text-based logo
function displayTextLogo(domain) {
  sourceLogoEl.innerHTML = domain;
  const colors = ['#bb1919', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b'];
  sourceLogoEl.style.background = colors[Math.floor(Math.random() * colors.length)];
  sourceLogoEl.style.padding = '0';
}

// Copy to clipboard
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showCopyFeedback();
    return true;
  } catch (error) {
    console.error('Copy failed:', error);
    return false;
  }
}

// Show copy feedback
function showCopyFeedback() {
  const feedback = document.createElement('div');
  feedback.className = 'copy-feedback';
  feedback.textContent = '✓ Copied to clipboard!';
  document.body.appendChild(feedback);
  
  setTimeout(() => {
    feedback.remove();
  }, 2000);
}

// Share URL
function shareUrl(platform) {
  const url = encodeURIComponent(currentShortUrl);
  const text = encodeURIComponent(currentPageTitle);
  
  const shareUrls = {
    whatsapp: `https://wa.me/?text=${text}%20${url}`,
    telegram: `https://t.me/share/url?url=${url}&text=${text}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    twitter: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
    reddit: `https://reddit.com/submit?url=${url}&title=${text}`,
    discord: `https://discord.com/channels/@me`,
    bluesky: `https://bsky.app/intent/compose?text=${text}%20${url}`,
    threads: `https://www.threads.net/intent/post?text=${text}%20${url}`,
    omn: `https://omn.com/share?url=${url}&title=${text}`
  };
  
  if (shareUrls[platform]) {
    chrome.tabs.create({ url: shareUrls[platform] });
  }
}

// Setup event listeners
function setupEventListeners() {
  if (historyIcon) {
    historyIcon.addEventListener('click', toggleHistoryView);
  }
  
  if (shortUrlEl) {
    shortUrlEl.addEventListener('click', () => {
      copyToClipboard(currentShortUrl);
    });
  }
  
  document.querySelectorAll('.share-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      if (action === 'copy') {
        copyToClipboard(currentShortUrl);
      } else {
        shareUrl(action);
      }
    });
  });
  
  if (scrollLeftBtn) {
    scrollLeftBtn.addEventListener('click', () => {
      shareActions.scrollBy({ left: -150, behavior: 'smooth' });
      setTimeout(updateScrollButtons, 300);
    });
  }
  
  if (scrollRightBtn) {
    scrollRightBtn.addEventListener('click', () => {
      shareActions.scrollBy({ left: 150, behavior: 'smooth' });
      setTimeout(updateScrollButtons, 300);
    });
  }
  
  if (shareActions) {
    shareActions.addEventListener('scroll', updateScrollButtons);
    updateScrollButtons();
  }
}

// Update scroll button states
function updateScrollButtons() {
  if (!shareActions || !scrollLeftBtn || !scrollRightBtn) return;
  
  const { scrollLeft, scrollWidth, clientWidth } = shareActions;
  
  scrollLeftBtn.disabled = scrollLeft <= 0;
  scrollRightBtn.disabled = scrollLeft + clientWidth >= scrollWidth - 1;
}

// Save to history with complete metadata
async function saveToHistory(longUrl, shortUrl, title, metadata) {
  try {
    const result = await chrome.storage.local.get(['urlHistory', 'urlClickCount']);
    const history = result.urlHistory || [];
    let clickCount = result.urlClickCount || {};
    
    // Check if short URL already exists
    const existingIndex = history.findIndex(item => item.shortUrl === shortUrl);
    
    if (existingIndex !== -1) {
      // Update existing entry
      clickCount[shortUrl] = (clickCount[shortUrl] || 1) + 1;
      history[existingIndex].clickCount = clickCount[shortUrl];
      // Move to top
      const [item] = history.splice(existingIndex, 1);
      history.unshift(item);
    } else {
      // New entry
      clickCount[shortUrl] = 1;
      history.unshift({
        longUrl,
        shortUrl,
        title,
        timestamp: new Date().toISOString(),
        favicon: metadata?.favicon || null,
        description: metadata?.description || null,
        siteName: metadata?.siteName || null,
        image: metadata?.image || null,
        clickCount: 1
      });
    }
    
    if (history.length > 50) {
      const removed = history.splice(50);
      removed.forEach(item => {
        delete clickCount[item.shortUrl];
      });
    }
    
    await chrome.storage.local.set({ urlHistory: history, urlClickCount: clickCount });
    console.log('History saved with metadata');
    
  } catch (error) {
    console.error('Error saving to history:', error);
  }
}

// Toggle history view
async function toggleHistoryView() {
  isHistoryView = !isHistoryView;
  
  if (isHistoryView) {
    await showHistoryView();
  } else {
    showMainView();
  }
}

// Show history view
async function showHistoryView() {
  mainCard.style.display = 'none';
  loadingState.style.display = 'none';
  errorState.style.display = 'none';
  historyView.style.display = 'block';
  shareContainer.style.display = 'none';
  
  await loadHistory();
}

// Show main view
function showMainView() {
  historyView.style.display = 'none';
  mainCard.style.display = 'block';
  shareContainer.style.display = 'flex';
}

// Load and display history
async function loadHistory() {
  try {
    const result = await chrome.storage.local.get(['urlHistory']);
    const history = result.urlHistory || [];
    
    console.log('Loaded history:', history.length, 'items');
    
    if (history.length === 0) {
      historyList.innerHTML = '';
      emptyHistory.style.display = 'block';
    } else {
      emptyHistory.style.display = 'none';
      displayHistory(history);
    }
    
  } catch (error) {
    console.error('Error loading history:', error);
    historyList.innerHTML = '';
    emptyHistory.style.display = 'block';
  }
}

// Display history items - no extra metadata fetching
function displayHistory(history) {
  historyList.innerHTML = '';
  
  history.forEach((item, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'history-item-wrapper';
    
    const card = createHistoryCard(item);
    wrapper.appendChild(card);
    
    if (index < history.length - 1) {
      const line = document.createElement('div');
      line.className = 'history-line';
      line.innerHTML = '<img src="assets/Extension+/WS Chrome Line.svg" alt="">';
      wrapper.appendChild(line);
    }
    
    historyList.appendChild(wrapper);
  });
}

// Create history card using existing metadata
function createHistoryCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  
  const domain = extractDomain(item.longUrl);
  const date = new Date(item.timestamp);
  const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateStr = `${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
  
  const logoId = `history-logo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const initialColor = getRandomColor();
  const displayTitle = item.title || 'Untitled Page';
  const clickCount = item.clickCount || 1;
  
  card.innerHTML = `
    <div class="source-header">
      <div class="source-logo" id="${logoId}" style="background: ${initialColor}">${domain}</div>
      <div class="source-info">
        <div class="short-url" title="Click to copy">${item.shortUrl}</div>
      </div>
    </div>
    <div class="page-title">${displayTitle}</div>
    <div class="original-url" title="${item.longUrl}">${item.longUrl}</div>
    <div class="timestamp">
      <span>${timeStr}</span>
      <span>${dateStr}</span>
    </div>
    <div class="history-actions">
      <button class="history-action-btn" title="Open in new window" data-action="open" data-url="${item.shortUrl}">
        <img src="assets/Open in New Window W.svg" alt="Open">
      </button>
      <button class="history-action-btn" title="Copy to clipboard" data-action="copy" data-url="${item.shortUrl}">
        <img src="assets/Share/Copy Icon W.svg" alt="Copy">
      </button>
      <button class="history-action-btn" title="Share" data-action="share" data-url="${item.shortUrl}">
        <img src="assets/Share W.svg" alt="Share">
      </button>
      <button class="history-action-btn" title="Delete" data-action="delete" data-url="${item.shortUrl}">
        <img src="assets/Delete Icon W.svg" alt="Delete">
      </button>
      <div class="history-clicks">
        <img src="assets/Counter - URL Clicks W.svg" alt="Clicks">
        <span>${clickCount}</span>
      </div>
    </div>
  `;
  
  // Load favicon asynchronously with timeout
  if (item.favicon) {
    setTimeout(() => {
      displayHistoryFavicon(logoId, item.favicon, domain, initialColor);
    }, 100);
  }
  
  // Add event listeners
  const actionButtons = card.querySelectorAll('.history-action-btn');
  actionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const url = btn.getAttribute('data-url');
      
      if (action === 'copy') {
        copyToClipboard(url);
      } else if (action === 'open') {
        chrome.tabs.create({ url: url });
      } else if (action === 'share') {
        copyToClipboard(url);
      } else if (action === 'delete') {
        deleteHistoryItem(item);
      }
    });
  });
  
  const shortUrlElInCard = card.querySelector('.short-url');
  if (shortUrlElInCard) {
    shortUrlElInCard.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(item.shortUrl);
    });
  }
  
  return card;
}

// Display favicon for history items with timeout
function displayHistoryFavicon(logoId, faviconUrl, domain, fallbackColor) {
  const logoEl = document.getElementById(logoId);
  if (!logoEl) return;
  
  const img = new Image();
  const timeout = setTimeout(() => {
    // Keep text logo as fallback
  }, 2000);
  
  img.onload = () => {
    clearTimeout(timeout);
    logoEl.innerHTML = '';
    logoEl.style.background = '#ffffff';
    logoEl.style.padding = '4px';
    logoEl.style.display = 'flex';
    logoEl.style.alignItems = 'center';
    logoEl.style.justifyContent = 'center';
    
    const faviconImg = document.createElement('img');
    faviconImg.src = faviconUrl;
    faviconImg.style.width = '100%';
    faviconImg.style.height = '100%';
    faviconImg.style.objectFit = 'contain';
    faviconImg.onerror = () => {
      // Keep original styling
    };
    
    logoEl.appendChild(faviconImg);
  };
  
  img.onerror = () => {
    clearTimeout(timeout);
    // Keep fallback styling
  };
  
  img.src = faviconUrl;
}

// Delete history item
async function deleteHistoryItem(itemToDelete) {
  try {
    const result = await chrome.storage.local.get(['urlHistory', 'urlClickCount']);
    let history = result.urlHistory || [];
    let clickCount = result.urlClickCount || {};
    
    history = history.filter(item => 
      item.shortUrl !== itemToDelete.shortUrl || 
      item.timestamp !== itemToDelete.timestamp
    );
    
    // Clean up click count if no more items with this short URL
    if (!history.some(item => item.shortUrl === itemToDelete.shortUrl)) {
      delete clickCount[itemToDelete.shortUrl];
    }
    
    await chrome.storage.local.set({ urlHistory: history, urlClickCount: clickCount });
    await loadHistory();
    
  } catch (error) {
    console.error('Error deleting history item:', error);
  }
}

// Get random color for logo
function getRandomColor() {
  const colors = ['#bb1919', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b'];
  return colors[Math.floor(Math.random() * colors.length)];
}