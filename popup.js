// DOM Elements
const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const mainCard = document.getElementById('mainCard');
const shortUrlEl = document.getElementById('shortUrl');
const pageTitleEl = document.getElementById('pageTitle');
const originalUrlEl = document.getElementById('originalUrl');
const timeDisplay = document.getElementById('timeDisplay');
const dateDisplay = document.getElementById('dateDisplay');
const sourceLogoEl = document.getElementById('sourceLogo');
const shareActions = document.getElementById('shareActions');
const scrollLeftBtn = document.getElementById('scrollLeft');
const scrollRightBtn = document.getElementById('scrollRight');

let currentShortUrl = '';
let currentPageTitle = '';
let currentOriginalUrl = '';
let currentMetadata = {};

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

async function init() {
  updateDateTime();
  setInterval(updateDateTime, 1000);
  await shortenCurrentTab();
  setupEventListeners();
}

// Get current tab info
async function getCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  } catch (error) {
    console.error('Error getting tab:', error);
    return null;
  }
}

// Fetch comprehensive page metadata using content script
async function fetchPageMetadata(tabId, url) {
  try {
    // Inject script to extract metadata from the actual page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Extract metadata from the current page
        const getMetaContent = (selectors) => {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element) {
              return element.content || element.textContent || element.href;
            }
          }
          return '';
        };

        const metadata = {
          // Title - try multiple sources
          title: getMetaContent([
            'meta[property="og:title"]',
            'meta[name="twitter:title"]',
            'meta[name="title"]',
            'title'
          ]) || document.title || 'Untitled Page',
          
          // Description
          description: getMetaContent([
            'meta[property="og:description"]',
            'meta[name="twitter:description"]',
            'meta[name="description"]'
          ]),
          
          // Site name
          siteName: getMetaContent([
            'meta[property="og:site_name"]',
            'meta[name="application-name"]'
          ]),
          
          // Favicon - try multiple sources
          favicon: getMetaContent([
            'link[rel="icon"]',
            'link[rel="shortcut icon"]',
            'link[rel="apple-touch-icon"]',
            'link[rel="apple-touch-icon-precomposed"]'
          ]),
          
          // Image
          image: getMetaContent([
            'meta[property="og:image"]',
            'meta[property="og:image:url"]',
            'meta[name="twitter:image"]',
            'meta[name="twitter:image:src"]'
          ]),
          
          // Type
          type: getMetaContent(['meta[property="og:type"]']) || 'website',
          
          // Author
          author: getMetaContent([
            'meta[name="author"]',
            'meta[property="article:author"]'
          ]),
          
          // Keywords
          keywords: getMetaContent(['meta[name="keywords"]']),
          
          // Published time
          publishedTime: getMetaContent([
            'meta[property="article:published_time"]',
            'meta[name="date"]',
            'meta[name="publish_date"]'
          ]),
          
          // Canonical URL
          canonical: getMetaContent(['link[rel="canonical"]']),
          
          // Language
          language: document.documentElement.lang || 
                    getMetaContent(['meta[http-equiv="content-language"]']) ||
                    'en',
          
          // Theme color
          themeColor: getMetaContent(['meta[name="theme-color"]'])
        };

        // Clean up the metadata
        Object.keys(metadata).forEach(key => {
          if (typeof metadata[key] === 'string') {
            metadata[key] = metadata[key].trim();
          }
        });

        return metadata;
      }
    });

    if (results && results[0] && results[0].result) {
      const metadata = results[0].result;
      
      // Resolve relative favicon URLs
      if (metadata.favicon && !metadata.favicon.startsWith('http')) {
        try {
          metadata.favicon = new URL(metadata.favicon, url).href;
        } catch (e) {
          metadata.favicon = `${new URL(url).origin}/favicon.ico`;
        }
      }
      
      // Add site name fallback
      if (!metadata.siteName) {
        metadata.siteName = extractSiteName(url);
      }
      
      // Add canonical URL fallback
      if (!metadata.canonical) {
        metadata.canonical = url;
      }
      
      // Add favicon fallback
      if (!metadata.favicon) {
        metadata.favicon = `${new URL(url).origin}/favicon.ico`;
      }
      
      return metadata;
    }
    
    throw new Error('Could not extract metadata');
    
  } catch (error) {
    console.error('Error fetching metadata:', error);
    // Return fallback metadata
    return {
      title: 'Page Title',
      description: '',
      siteName: extractSiteName(url),
      favicon: `${new URL(url).origin}/favicon.ico`,
      image: '',
      type: 'website',
      author: '',
      keywords: '',
      publishedTime: '',
      canonical: url,
      language: 'en',
      themeColor: ''
    };
  }
}

// Extract site name from URL
function extractSiteName(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const parts = hostname.split('.');
    
    if (parts.length > 1) {
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
    return hostname;
  } catch (error) {
    return 'Website';
  }
}

// Extract domain name for logo
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const parts = hostname.split('.');
    
    // Get main domain name
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

// Get favicon URL with fallbacks
function getFaviconUrl(url, metadata) {
  if (metadata && metadata.favicon) {
    return metadata.favicon;
  }
  
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}/favicon.ico`;
  } catch (error) {
    return null;
  }
}

// Shorten URL using multiple services
async function shortenUrl(url) {
  // Try TinyURL first
  try {
    const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    console.error('TinyURL failed:', error);
  }

  // Try is.gd as fallback
  try {
    const response = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    console.error('is.gd failed:', error);
  }

  // Try v.gd as second fallback
  try {
    const response = await fetch(`https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
    if (response.ok) {
      return await response.text();
    }
  } catch (error) {
    console.error('v.gd failed:', error);
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
    
    // Fetch comprehensive metadata using content script
    currentMetadata = await fetchPageMetadata(tab.id, currentOriginalUrl);
    
    // Use metadata title or fall back to tab title
    currentPageTitle = currentMetadata.title || tab.title || 'Untitled Page';
    
    // Shorten URL
    currentShortUrl = await shortenUrl(currentOriginalUrl);
    
    // Extract domain for logo
    const domain = extractDomain(currentOriginalUrl);
    
    // Update UI with all metadata
    displayResult(currentShortUrl, currentPageTitle, currentOriginalUrl, domain, currentMetadata);
    
    // Log metadata for debugging
    console.log('Fetched Metadata:', currentMetadata);
    
  } catch (error) {
    console.error('Error:', error);
    showError(error.message);
  }
}

// Update date and time display
function updateDateTime() {
  const now = new Date();
  
  // Time (HH:MM)
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  timeDisplay.textContent = `${hours}:${minutes}`;
  
  // Date (DD Month YYYY)
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
}

// Show error state
function showError(message) {
  loadingState.style.display = 'none';
  errorState.style.display = 'block';
  errorState.textContent = message;
  mainCard.style.display = 'none';
}

// Display result with metadata
function displayResult(shortUrl, title, originalUrl, domain, metadata) {
  loadingState.style.display = 'none';
  errorState.style.display = 'none';
  mainCard.style.display = 'block';
  
  shortUrlEl.textContent = shortUrl;
  pageTitleEl.textContent = title;
  pageTitleEl.title = title; // Full title on hover
  originalUrlEl.textContent = originalUrl;
  originalUrlEl.title = originalUrl; // Full URL on hover
  
  // Try to use favicon as logo
  const faviconUrl = getFaviconUrl(originalUrl, metadata);
  
  if (faviconUrl) {
    // Try to load favicon
    const img = new Image();
    img.onload = function() {
      // Successfully loaded favicon
      sourceLogoEl.innerHTML = '';
      sourceLogoEl.style.background = '#ffffff';
      sourceLogoEl.style.padding = '4px';
      const faviconImg = document.createElement('img');
      faviconImg.src = faviconUrl;
      faviconImg.style.width = '100%';
      faviconImg.style.height = '100%';
      faviconImg.style.objectFit = 'contain';
      sourceLogoEl.appendChild(faviconImg);
    };
    img.onerror = function() {
      // Fallback to text if favicon fails
      displayTextLogo(domain);
    };
    img.src = faviconUrl;
  } else {
    // No favicon, use text
    displayTextLogo(domain);
  }
  
  // Add description as tooltip if available
  if (metadata.description) {
    pageTitleEl.title = `${title}\n\n${metadata.description}`;
  }
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
  const description = currentMetadata.description ? encodeURIComponent(currentMetadata.description) : text;
  
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
  // Short URL click - copy to clipboard
  shortUrlEl.addEventListener('click', () => {
    copyToClipboard(currentShortUrl);
  });
  
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
  scrollLeftBtn.addEventListener('click', () => {
    shareActions.scrollBy({ left: -150, behavior: 'smooth' });
    setTimeout(updateScrollButtons, 300);
  });
  
  scrollRightBtn.addEventListener('click', () => {
    shareActions.scrollBy({ left: 150, behavior: 'smooth' });
    setTimeout(updateScrollButtons, 300);
  });
  
  // Update scroll button states
  shareActions.addEventListener('scroll', updateScrollButtons);
  updateScrollButtons();
}

// Update scroll button states
function updateScrollButtons() {
  const { scrollLeft, scrollWidth, clientWidth } = shareActions;
  
  scrollLeftBtn.disabled = scrollLeft <= 0;
  scrollRightBtn.disabled = scrollLeft + clientWidth >= scrollWidth - 1;
}