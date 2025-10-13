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

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    updateDateTime();
    setInterval(updateDateTime, 1000);
    await shortenCurrentTab();
    setupEventListeners();
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize extension');
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

// Fetch page metadata from original URL
async function fetchPageMetadataFromUrl(url) {
  try {
    const response = await fetch(url, { method: 'GET' });
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

    let favicon = getMetaContent([
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]'
    ]);

    // Resolve relative favicon URLs to absolute URLs
    if (favicon && !favicon.startsWith('http')) {
      try {
        favicon = new URL(favicon, url).href;
      } catch (e) {
        favicon = new URL(url).origin + (favicon.startsWith('/') ? favicon : '/' + favicon);
      }
    }

    // Fallback to standard favicon location if not found
    if (!favicon) {
      favicon = new URL(url).origin + '/favicon.ico';
    }

    const metadata = {
      title: getMetaContent([
        'meta[property="og:title"]',
        'meta[name="twitter:title"]',
        'meta[name="title"]'
      ]) || doc.querySelector('title')?.textContent || 'Untitled Page',
      
      description: getMetaContent([
        'meta[property="og:description"]',
        'meta[name="twitter:description"]',
        'meta[name="description"]'
      ]),
      
      siteName: getMetaContent([
        'meta[property="og:site_name"]',
        'meta[name="application-name"]'
      ]),
      
      image: getMetaContent([
        'meta[property="og:image"]',
        'meta[property="og:image:url"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]'
      ]),
      
      favicon: favicon
    };

    return metadata;
  } catch (error) {
    console.error('Error fetching metadata from URL:', error);
    return null;
  }
}

// Fetch page title using content script (fallback)
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

    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
    return 'Untitled Page';
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

    // Check if URL is valid for shortening
    if (!tab.url.startsWith('http://') && !tab.url.startsWith('https://')) {
      throw new Error('Cannot shorten this type of URL');
    }

    currentOriginalUrl = tab.url;
    
    // Try to fetch metadata from the original URL
    let metadata = await fetchPageMetadataFromUrl(currentOriginalUrl);
    
    // Fallback: fetch from content script if URL metadata fails
    if (!metadata || !metadata.title) {
      currentPageTitle = await fetchPageTitle(tab.id);
      currentMetadata = metadata || {};
    } else {
      currentPageTitle = metadata.title || tab.title || 'Untitled Page';
      currentMetadata = metadata;
    }
    
    // Shorten URL
    currentShortUrl = await shortenUrl(currentOriginalUrl);
    
    // Extract domain for logo
    const domain = extractDomain(currentOriginalUrl);
    
    // Update UI with metadata
    displayResult(currentShortUrl, currentPageTitle, currentOriginalUrl, domain, currentMetadata);
    
    // Save to history
    await saveToHistory(currentOriginalUrl, currentShortUrl, currentPageTitle);
    
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
  
  // Set logo with favicon if available
  if (metadata && metadata.favicon) {
    displayFaviconLogo(metadata.favicon, domain);
  } else {
    displayTextLogo(domain);
  }
}

// Display favicon logo
function displayFaviconLogo(faviconUrl, domain) {
  const img = new Image();
  
  img.onload = () => {
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
    faviconImg.onerror = () => {
      // Fallback to text logo if favicon fails to load
      displayTextLogo(domain);
    };
    
    sourceLogoEl.appendChild(faviconImg);
  };
  
  img.onerror = () => {
    // Fallback to text logo if favicon fails
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
  // History icon click
  if (historyIcon) {
    historyIcon.addEventListener('click', toggleHistoryView);
  }
  
  // Short URL click - copy to clipboard
  if (shortUrlEl) {
    shortUrlEl.addEventListener('click', () => {
      copyToClipboard(currentShortUrl);
    });
  }
  
  // Share buttons
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
  
  // Scroll buttons for share actions
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
  
  // Update scroll button states
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

// Save to history
async function saveToHistory(longUrl, shortUrl, title) {
  try {
    const result = await chrome.storage.local.get(['urlHistory']);
    const history = result.urlHistory || [];
    
    history.unshift({
      longUrl,
      shortUrl,
      title,
      timestamp: new Date().toISOString()
    });
    
    // Keep only last 50 entries
    if (history.length > 50) {
      history.splice(50);
    }
    
    await chrome.storage.local.set({ urlHistory: history });
    console.log('History saved:', history.length, 'items');
    
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

// Display history items
function displayHistory(history) {
  historyList.innerHTML = '';
  
  history.forEach((item, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'history-item-wrapper';
    
    const card = createHistoryCard(item);
    wrapper.appendChild(card);
    
    // Add vertical line between items (except for last item)
    if (index < history.length - 1) {
      const line = document.createElement('div');
      line.className = 'history-line';
      line.innerHTML = '<img src="assets/Extension+/WS Chrome Line.svg" alt="">';
      wrapper.appendChild(line);
    }
    
    historyList.appendChild(wrapper);
  });
}

// Create history card
function createHistoryCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  
  const domain = extractDomain(item.longUrl);
  const date = new Date(item.timestamp);
  const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateStr = `${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
  
  card.innerHTML = `
    <div class="source-header">
      <div class="source-logo" style="background: ${getRandomColor()}">${domain}</div>
      <div class="source-info">
        <div class="short-url" title="Click to copy">${item.shortUrl}</div>
      </div>
    </div>
    <div class="page-title">${item.title || 'Untitled Page'}</div>
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
        <span>120</span>
      </div>
    </div>
  `;
  
  // Add event listeners to action buttons
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
        // You can implement share functionality here
        copyToClipboard(url);
      } else if (action === 'delete') {
        deleteHistoryItem(item);
      }
    });
  });
  
  // Click on short URL to copy
  const shortUrlElInCard = card.querySelector('.short-url');
  if (shortUrlElInCard) {
    shortUrlElInCard.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(item.shortUrl);
    });
  }
  
  return card;
}

// Delete history item
async function deleteHistoryItem(itemToDelete) {
  try {
    const result = await chrome.storage.local.get(['urlHistory']);
    let history = result.urlHistory || [];
    
    history = history.filter(item => 
      item.shortUrl !== itemToDelete.shortUrl || 
      item.timestamp !== itemToDelete.timestamp
    );
    
    await chrome.storage.local.set({ urlHistory: history });
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