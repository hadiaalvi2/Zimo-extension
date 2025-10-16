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

// Helper function to send message with retry
async function sendMessageWithRetry(message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      return response;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * (i + 1)));
    }
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

// Save metadata to cache (using ORIGINAL URL as key)
async function saveMetadataToCache(originalUrl, metadata) {
  try {
    metadataCache[originalUrl] = {
      ...metadata,
      cachedAt: Date.now()
    };
    
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

// QR Code Generator Function
function generateQRCode(text) {
  const size = 200;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
  return qrApiUrl;
}

// QR Modal Function
window.showQRModal = function(url) {
  const modal = document.createElement('div');
  modal.className = 'qr-modal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  const modalContent = document.createElement('div');
  modalContent.className = 'qr-modal-content';
  modalContent.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 90%;
    text-align: center;
  `;
  
  modalContent.innerHTML = `
    <div class="qr-modal-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0; font-size: 18px; color: #333;">QR Code</h3>
      <button class="qr-close-btn" style="background: none; border: none; font-size: 28px; cursor: pointer; color: #666; line-height: 1;">&times;</button>
    </div>
    <div class="qr-modal-body">
      <img src="${generateQRCode(url)}" alt="QR Code" class="qr-code-img" style="max-width: 200px; margin: 16px auto; display: block;">
      <p class="qr-url" style="word-break: break-all; font-size: 12px; color: #666; margin: 12px 0;">${url}</p>
      <button class="qr-download-btn" style="background: #1976d2; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px;">Download QR Code</button>
    </div>
  `;
  
  modal.appendChild(modalContent);
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

// Enhanced Native Share Function with Rich Metadata
window.nativeShare = async function(shortUrl, title, description, imageUrl) {
  if (navigator.share) {
    try {
      const shareData = {
        title: title || 'Check out this link',
        text: description || currentPageTitle || 'Shortened URL',
        url: shortUrl
      };
      
      await navigator.share(shareData);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Share failed:', err);
        alert('Share failed. Please try copying the link instead.');
      }
    }
  } else {
    alert('Native sharing is not supported in this browser. Please use the share icons or copy the link.');
  }
}

// ENHANCED: Fetch metadata from original URL
async function fetchPageMetadataFromUrl(originalUrl, useCache = true) {
  try {
    // Check cache first (valid for 1 hour)
    if (useCache && metadataCache[originalUrl]) {
      const cached = metadataCache[originalUrl];
      const cacheAge = Date.now() - (cached.cachedAt || 0);
      if (cacheAge < 3600000) { // 1 hour
        console.log('Using cached metadata for:', originalUrl);
        return cached;
      }
    }

    console.log('Requesting metadata from background script for:', originalUrl);
    
    const response = await sendMessageWithRetry({ 
      action: 'fetchMetadata', 
      url: originalUrl 
    });
    
    if (response && response.success) {
      const metadata = response.metadata;
      console.log('Received metadata from background:', metadata);
      await saveMetadataToCache(originalUrl, metadata);
      return metadata;
    } else {
      throw new Error(response?.error || 'Failed to fetch metadata');
    }
  } catch (error) {
    console.error('Error fetching metadata:', error);
    
    // Return minimal fallback
    return {
      title: 'Untitled Page',
      description: '',
      siteName: '',
      image: '',
      favicon: '',
      url: originalUrl,
      type: 'website'
    };
  }
}

// Extract domain name for logo
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    
    // Special cases
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'YT';
    }
    if (hostname.includes('facebook.com')) {
      return 'FB';
    }
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return 'X';
    }
    if (hostname.includes('instagram.com')) {
      return 'IG';
    }
    if (hostname.includes('linkedin.com')) {
      return 'IN';
    }
    if (hostname.includes('reddit.com')) {
      return 'RD';
    }
    if (hostname.includes('github.com')) {
      return 'GH';
    }
    if (hostname.includes('tiktok.com')) {
      return 'TT';
    }
    
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

// Get logo color based on domain
function getDomainColor(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    // Special colors for popular sites
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return '#FF0000';
    }
    if (hostname.includes('facebook.com')) {
      return '#1877F2';
    }
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
      return '#000000';
    }
    if (hostname.includes('instagram.com')) {
      return '#E4405F';
    }
    if (hostname.includes('linkedin.com')) {
      return '#0A66C2';
    }
    if (hostname.includes('reddit.com')) {
      return '#FF4500';
    }
    if (hostname.includes('github.com')) {
      return '#181717';
    }
    if (hostname.includes('tiktok.com')) {
      return '#000000';
    }
    if (hostname.includes('whatsapp.com')) {
      return '#25D366';
    }
    if (hostname.includes('telegram.org')) {
      return '#0088CC';
    }
    if (hostname.includes('discord.com')) {
      return '#5865F2';
    }
    
    // Default random colors
    const colors = ['#bb1919', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2', '#c2185b', '#0097A7', '#7B1FA2'];
    let hash = 0;
    for (let i = 0; i < hostname.length; i++) {
      hash = hostname.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  } catch (error) {
    return '#bb1919';
  }
}

// Enhanced URL shortening function
async function shortenUrl(url) {
  try {
    console.log('Attempting to shorten via background script...');
    const response = await sendMessageWithRetry({ 
      action: 'shortenUrl', 
      url: url 
    });
    
    if (response && response.success) {
      console.log('Successfully shortened via background script:', response.shortUrl);
      return response.shortUrl;
    }
  } catch (error) {
    console.error('Background script failed, trying direct API calls:', error);
  }

  console.log('Attempting direct API calls from popup...');
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
      console.log(`Trying ${service.name} directly from popup...`);
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

// CRITICAL FIX: Wait for shortened URL to be indexed by sharing platforms
async function waitForShortUrlIndexing(shortUrl, maxWaitTime = 3000) {
  console.log('Waiting for short URL to be indexed...', shortUrl);
  
  // Give the URL shortening service time to set up the redirect properly
  return new Promise(resolve => {
    setTimeout(() => {
      console.log('Short URL should now be ready for sharing');
      resolve();
    }, maxWaitTime);
  });
}

// ENHANCED: Main function to shorten current tab with metadata
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
    
    console.log('Current tab URL:', currentOriginalUrl);
    
    // STEP 1: Fetch metadata from ORIGINAL URL FIRST
    console.log('Step 1: Fetching metadata from original URL...');
    let metadata = await fetchPageMetadataFromUrl(currentOriginalUrl);
    
    currentPageTitle = metadata.title || tab.title || 'Untitled Page';
    currentMetadata = metadata;
    
    console.log('Step 1 Complete - Metadata fetched:', {
      title: currentMetadata.title,
      description: currentMetadata.description?.substring(0, 50),
      image: currentMetadata.image,
      favicon: currentMetadata.favicon,
      type: currentMetadata.type
    });
    
    // STEP 2: Shorten URL
    console.log('Step 2: Shortening URL...');
    currentShortUrl = await shortenUrl(currentOriginalUrl);
    console.log('Step 2 Complete - URL shortened:', currentShortUrl);
    
    // STEP 3: Wait for URL shortening service to index the redirect
    console.log('Step 3: Waiting for short URL to be indexed...');
    await waitForShortUrlIndexing(currentShortUrl, 2000);
    console.log('Step 3 Complete - Short URL should be ready');
    
    // STEP 4: Display result with metadata
    const domain = extractDomain(currentOriginalUrl);
    const color = getDomainColor(currentOriginalUrl);
    displayResult(currentShortUrl, currentPageTitle, currentOriginalUrl, domain, currentMetadata, color);
    
    // STEP 5: Save to history with complete metadata
    console.log('Step 4: Saving to history with metadata...');
    await saveToHistory(currentOriginalUrl, currentShortUrl, currentPageTitle, currentMetadata);
    console.log('Step 4 Complete - Saved to history');
    
  } catch (error) {
    console.error('Error in shortenCurrentTab:', error);
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
function displayResult(shortUrl, title, originalUrl, domain, metadata, color) {
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
    displayFaviconLogo(metadata.favicon, domain, color);
  } else {
    displayTextLogo(domain, color);
  }
  
  console.log('Display complete with metadata:', {
    shortUrl,
    title,
    hasImage: !!metadata?.image,
    hasDescription: !!metadata?.description,
    type: metadata?.type
  });
}

// Display favicon logo with error handling
function displayFaviconLogo(faviconUrl, domain, fallbackColor) {
  const img = new Image();
  const timeout = setTimeout(() => {
    displayTextLogo(domain, fallbackColor);
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
    faviconImg.onerror = () => displayTextLogo(domain, fallbackColor);
    
    sourceLogoEl.appendChild(faviconImg);
  };
  
  img.onerror = () => {
    clearTimeout(timeout);
    displayTextLogo(domain, fallbackColor);
  };
  
  img.src = faviconUrl;
}

// Display text-based logo
function displayTextLogo(domain, color) {
  sourceLogoEl.innerHTML = domain;
  sourceLogoEl.style.background = color || '#bb1919';
  sourceLogoEl.style.padding = '0';
  sourceLogoEl.style.display = 'flex';
  sourceLogoEl.style.alignItems = 'center';
  sourceLogoEl.style.justifyContent = 'center';
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
  feedback.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #4caf50;
    color: white;
    padding: 12px 24px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(feedback);
  
  setTimeout(() => {
    feedback.remove();
  }, 2000);
}

// CRITICAL FIX: Enhanced share function - shortened URLs will redirect and platforms will fetch metadata
function shareUrl(platform) {
  const shortUrl = currentShortUrl;
  const originalUrl = currentOriginalUrl;
  const title = currentPageTitle;
  const description = currentMetadata.description || '';
  const image = currentMetadata.image || '';
  
  console.log('Sharing short URL - platforms will fetch metadata after redirect:', {
    platform,
    shortUrl,
    originalUrl,
    title,
    description: description.substring(0, 50),
    image,
    type: currentMetadata.type
  });
  
  // IMPORTANT: When platforms fetch shortened URLs:
  // 1. They follow the redirect to the original URL
  // 2. They scrape Open Graph metadata from the original URL
  // 3. Rich previews are generated from the original page's metadata
  
  const url = encodeURIComponent(shortUrl);
  const text = encodeURIComponent(title);
  const fullText = encodeURIComponent(`${title}${description ? '\n\n' + description : ''}`);
  
  const shareUrls = {
    // WhatsApp - Will fetch metadata from redirected URL
    whatsapp: `https://wa.me/?text=${url}`,
    
    // Telegram - Will fetch metadata from redirected URL  
    telegram: `https://t.me/share/url?url=${url}&text=${text}`,
    
    // Facebook - Will fetch metadata from redirected URL
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    
    // Twitter/X - Will fetch metadata from redirected URL
    twitter: `https://twitter.com/intent/tweet?url=${url}&text=${text}`,
    
    // Reddit - Will fetch metadata from redirected URL
    reddit: `https://reddit.com/submit?url=${url}&title=${text}`,
    
    // LinkedIn - Will fetch metadata from redirected URL
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    
    // Email - Include both short URL and metadata
    email: `mailto:?subject=${text}&body=${encodeURIComponent(
      title + 
      (description ? '\n\n' + description : '') + 
      '\n\n' + shortUrl
    )}`,
    
    // Discord - Will fetch metadata from redirected URL
    discord: `https://discord.com/channels/@me`,
    
    // BlueSky - Include title and short URL
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(title + '\n\n' + shortUrl)}`,
    
    // Threads - Include title and short URL
    threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(title + '\n\n' + shortUrl)}`,
    
    // QR Code
    qr: () => window.showQRModal(shortUrl),
    
    // Native Share with rich data
    native: () => window.nativeShare(shortUrl, title, description, image)
  };
  
  if (typeof shareUrls[platform] === 'function') {
    shareUrls[platform]();
  } else if (shareUrls[platform]) {
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
      } else if (action === 'qr') {
        window.showQRModal(currentShortUrl);
      } else if (action === 'native') {
        window.nativeShare(currentShortUrl, currentPageTitle, currentMetadata.description, currentMetadata.image);
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

// ENHANCED: Save to history with complete metadata from original URL
async function saveToHistory(longUrl, shortUrl, title, metadata) {
  try {
    const result = await chrome.storage.local.get(['urlHistory', 'urlClickCount']);
    const history = result.urlHistory || [];
    let clickCount = result.urlClickCount || {};
    
    const existingIndex = history.findIndex(item => item.shortUrl === shortUrl);
    
    const historyItem = {
      longUrl,
      shortUrl,
      title,
      timestamp: new Date().toISOString(),
      favicon: metadata?.favicon || null,
      description: metadata?.description || null,
      siteName: metadata?.siteName || null,
      image: metadata?.image || null,
      video: metadata?.video || null,
      channel: metadata?.channel || null,
      type: metadata?.type || 'website',
      clickCount: 1
    };
    
    if (existingIndex !== -1) {
      clickCount[shortUrl] = (clickCount[shortUrl] || 1) + 1;
      historyItem.clickCount = clickCount[shortUrl];
      history[existingIndex] = historyItem;
      const [item] = history.splice(existingIndex, 1);
      history.unshift(item);
    } else {
      clickCount[shortUrl] = 1;
      history.unshift(historyItem);
    }
    
    if (history.length > 50) {
      const removed = history.splice(50);
      removed.forEach(item => {
        delete clickCount[item.shortUrl];
      });
    }
    
    await chrome.storage.local.set({ urlHistory: history, urlClickCount: clickCount });
    console.log('History saved with complete metadata:', {
      title: historyItem.title,
      hasDescription: !!historyItem.description,
      hasImage: !!historyItem.image,
      hasFavicon: !!historyItem.favicon,
      type: historyItem.type
    });
    
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
    
    const line = document.createElement('div');
    line.className = 'history-line';
    wrapper.appendChild(line);
    
    const card = createHistoryCard(item);
    wrapper.appendChild(card);
    
    historyList.appendChild(wrapper);
  });
}

// Create history card
function createHistoryCard(item) {
  const card = document.createElement('div');
  card.className = 'card';
  
  const domain = extractDomain(item.longUrl);
  const color = getDomainColor(item.longUrl);
  const date = new Date(item.timestamp);
  const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateStr = `${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}`;
  
  const logoId = `history-logo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const displayTitle = item.title || 'Untitled Page';
  const clickCount = item.clickCount || 1;
  
  card.innerHTML = `
    <div class="source-header">
      <div class="source-logo" id="${logoId}" style="background: ${color}">${domain}</div>
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
      <button class="history-action-btn" title="Open original URL" data-action="open" data-url="${item.longUrl}">
        <img src="assets/Open in New Window W.svg" alt="Open">
      </button>
      <button class="history-action-btn" title="Copy short URL" data-action="copy" data-url="${item.shortUrl}">
        <img src="assets/Share/Copy Icon W.svg" alt="Copy">
      </button>
      <button class="history-action-btn" title="QR Code" data-action="qr" data-url="${item.shortUrl}">
        <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; fill: currentColor;">
          <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zm8-2v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm13-2h-2v3h-3v2h3v3h2v-3h3v-2h-3v-3zm0-1h3v-3h-3v3z"/>
        </svg>
      </button>
      <button class="history-action-btn" title="Share" data-action="share" data-short-url="${item.shortUrl}" data-long-url="${item.longUrl}" data-title="${displayTitle}">
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
  
  // Load favicon asynchronously
  if (item.favicon) {
    setTimeout(() => {
      displayHistoryFavicon(logoId, item.favicon, domain, color);
    }, 100);
  }
  
  // Add event listeners
  const actionButtons = card.querySelectorAll('.history-action-btn');
  actionButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      
      if (action === 'copy') {
        const url = btn.getAttribute('data-url');
        copyToClipboard(url);
      } else if (action === 'open') {
        const url = btn.getAttribute('data-url');
        chrome.tabs.create({ url: url });
      } else if (action === 'qr') {
        const url = btn.getAttribute('data-url');
        window.showQRModal(url);
      } else if (action === 'share') {
        const shortUrl = btn.getAttribute('data-short-url');
        const longUrl = btn.getAttribute('data-long-url');
        const title = btn.getAttribute('data-title');
        
        currentShortUrl = shortUrl;
        currentOriginalUrl = longUrl;
        currentPageTitle = title || item.title;
        currentMetadata = {
          title: item.title,
          description: item.description,
          siteName: item.siteName,
          image: item.image,
          favicon: item.favicon,
          video: item.video,
          channel: item.channel,
          type: item.type
        };
        
        console.log('Loaded metadata from history for sharing:', currentMetadata);
        
        showMainView();
        displayResult(currentShortUrl, currentPageTitle, currentOriginalUrl, domain, currentMetadata, color);
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

// Display favicon for history items
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
    
    if (!history.some(item => item.shortUrl === itemToDelete.shortUrl)) {
      delete clickCount[itemToDelete.shortUrl];
    }
    
    await chrome.storage.local.set({ urlHistory: history, urlClickCount: clickCount });
    await loadHistory();
    
  } catch (error) {
    console.error('Error deleting history item:', error);
  }
}

// Refresh functionality for manual retry
window.refreshShortUrl = async function() {
  await shortenCurrentTab();
};

// Export functionality for history
window.exportHistory = async function() {
  try {
    const result = await chrome.storage.local.get(['urlHistory']);
    const history = result.urlHistory || [];
    
    if (history.length === 0) {
      alert('No history to export');
      return;
    }
    
    const csvContent = [
      ['Short URL', 'Original URL', 'Title', 'Description', 'Site Name', 'Click Count', 'Date'],
      ...history.map(item => [
        item.shortUrl,
        item.longUrl,
        item.title,
        item.description || '',
        item.siteName || '',
        item.clickCount || 1,
        new Date(item.timestamp).toLocaleDateString()
      ])
    ].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `url-shortener-history-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('Error exporting history:', error);
    alert('Failed to export history');
  }
};

// Clear all history
window.clearAllHistory = async function() {
  if (confirm('Are you sure you want to clear all history? This action cannot be undone.')) {
    try {
      await chrome.storage.local.set({ urlHistory: [], urlClickCount: {} });
      await loadHistory();
      alert('History cleared successfully');
    } catch (error) {
      console.error('Error clearing history:', error);
      alert('Failed to clear history');
    }
  }
};