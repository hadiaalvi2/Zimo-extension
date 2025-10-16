// Keep service worker alive
let keepAliveInterval;

function startKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {
      // Just to keep the service worker alive
    });
  }, 20000); // Every 20 seconds
}

startKeepAlive();

// Shorten URL function
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
      const response = await fetch(service.url, {
        method: service.method,
        headers: {
          'Accept': 'text/plain'
        }
      });

      if (response.ok) {
        const shortUrl = await response.text();
        if (shortUrl && !shortUrl.includes('Error') && shortUrl.startsWith('http')) {
          return shortUrl.trim();
        }
      }
    } catch (error) {
      console.error(`${service.name} failed:`, error);
    }
  }

  throw new Error('All URL shortening services failed');
}

// ENHANCED: Fetch COMPLETE page metadata from ORIGINAL URL with special YouTube handling
async function fetchPageMetadataFromUrl(url) {
  try {
    console.log('Background: Fetching metadata from ORIGINAL URL:', url);
    
    // Special handling for YouTube URLs
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      return await fetchYouTubeMetadata(url);
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // Increased timeout
    
    const response = await fetch(url, { 
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.error('Response not OK:', response.status);
      throw new Error('Failed to fetch URL');
    }
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const getMetaContent = (selectors) => {
      for (const selector of selectors) {
        const element = doc.querySelector(selector);
        if (element) {
          const content = element.content || element.getAttribute('content') || element.textContent || element.href;
          if (content && content.trim()) {
            return content.trim();
          }
        }
      }
      return '';
    };

    // Get title with priority order
    const title = getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]',
      'meta[property="title"]',
      'meta[itemprop="name"]'
    ]) || doc.querySelector('title')?.textContent?.trim() || 'Untitled Page';

    // Get description with multiple fallbacks
    const description = getMetaContent([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
      'meta[property="description"]',
      'meta[itemprop="description"]'
    ]);

    // Get site name
    const siteName = getMetaContent([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
      'meta[name="apple-mobile-web-app-title"]'
    ]);

    // Get image with multiple sources
    const image = getMetaContent([
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'meta[itemprop="image"]',
      'link[rel="image_src"]'
    ]);

    // Get favicon with multiple fallbacks
    let favicon = getMetaContent([
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',
      'meta[itemprop="image"]'
    ]);

    // Resolve relative URLs to absolute URLs
    if (favicon && !favicon.startsWith('http')) {
      try {
        favicon = new URL(favicon, url).href;
      } catch (e) {
        const urlObj = new URL(url);
        favicon = urlObj.origin + (favicon.startsWith('/') ? favicon : '/' + favicon);
      }
    }

    // Fallback to standard favicon location
    if (!favicon) {
      const urlObj = new URL(url);
      favicon = `${urlObj.origin}/favicon.ico`;
    }

    // Get video metadata if available
    const video = getMetaContent([
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[property="og:video:secure_url"]'
    ]);

    const metadata = {
      title: cleanText(title),
      description: cleanText(description) || '',
      siteName: cleanText(siteName) || '',
      image: image || '',
      favicon: favicon,
      video: video || '',
      url: url
    };

    console.log('Background: Fetched complete metadata:', metadata);
    return metadata;
  } catch (error) {
    console.error('Background: Error fetching metadata from URL:', error);
    return {
      title: 'Untitled Page',
      description: '',
      siteName: '',
      image: '',
      favicon: '',
      video: '',
      url: url
    };
  }
}

// ENHANCED: Special YouTube metadata fetcher
async function fetchYouTubeMetadata(url) {
  try {
    console.log('Fetching YouTube metadata for:', url);
    
    // Extract video ID from various YouTube URL formats
    let videoId = null;
    
    if (url.includes('youtube.com/watch')) {
      const urlParams = new URLSearchParams(new URL(url).search);
      videoId = urlParams.get('v');
    } else if (url.includes('youtu.be/')) {
      videoId = url.split('youtu.be/')[1]?.split('?')[0]?.split('&')[0];
    } else if (url.includes('youtube.com/embed/')) {
      videoId = url.split('youtube.com/embed/')[1]?.split('?')[0];
    }
    
    if (!videoId) {
      throw new Error('Could not extract YouTube video ID');
    }
    
    console.log('YouTube Video ID:', videoId);
    
    // Fetch the YouTube page
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    const getMetaContent = (selectors) => {
      for (const selector of selectors) {
        const element = doc.querySelector(selector);
        if (element) {
          const content = element.content || element.getAttribute('content');
          if (content && content.trim()) {
            return content.trim();
          }
        }
      }
      return '';
    };
    
    // Extract title
    const title = getMetaContent([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]'
    ]) || doc.querySelector('title')?.textContent?.replace(' - YouTube', '')?.trim() || 'YouTube Video';
    
    // Extract description
    const description = getMetaContent([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]'
    ]);
    
    // YouTube thumbnail (high quality)
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    
    // Alternative thumbnail sizes as fallback
    const thumbnailMedium = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    
    // YouTube favicon
    const favicon = 'https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png';
    
    // Extract channel/author info
    const channel = getMetaContent([
      'meta[name="author"]',
      'link[itemprop="name"]'
    ]) || 'YouTube';
    
    const metadata = {
      title: cleanText(title),
      description: cleanText(description) || '',
      siteName: 'YouTube',
      image: thumbnail,
      favicon: favicon,
      video: url,
      url: url,
      channel: cleanText(channel),
      videoId: videoId,
      thumbnailMedium: thumbnailMedium
    };
    
    console.log('YouTube metadata extracted:', metadata);
    return metadata;
    
  } catch (error) {
    console.error('Error fetching YouTube metadata:', error);
    
    // Fallback with basic info
    let videoId = null;
    try {
      if (url.includes('youtube.com/watch')) {
        const urlParams = new URLSearchParams(new URL(url).search);
        videoId = urlParams.get('v');
      } else if (url.includes('youtu.be/')) {
        videoId = url.split('youtu.be/')[1]?.split('?')[0];
      }
    } catch (e) {
      console.error('Could not extract video ID:', e);
    }
    
    return {
      title: 'YouTube Video',
      description: '',
      siteName: 'YouTube',
      image: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '',
      favicon: 'https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png',
      video: url,
      url: url,
      videoId: videoId || ''
    };
  }
}

// Clean text helper
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\r\n\t]/g, ' ')
    .trim()
    .substring(0, 500); // Limit length
}

// Track short URL clicks
async function trackShortUrlClick(shortUrl) {
  try {
    const result = await chrome.storage.local.get(['urlHistory', 'urlClickCount']);
    const history = result.urlHistory || [];
    let clickCount = result.urlClickCount || {};

    // Increment click count
    clickCount[shortUrl] = (clickCount[shortUrl] || 1) + 1;

    // Update history items with this short URL
    history.forEach(item => {
      if (item.shortUrl === shortUrl) {
        item.clickCount = clickCount[shortUrl];
      }
    });

    // Move the item to top
    const itemIndex = history.findIndex(item => item.shortUrl === shortUrl);
    if (itemIndex > 0) {
      const [item] = history.splice(itemIndex, 1);
      history.unshift(item);
    }

    await chrome.storage.local.set({ urlHistory: history, urlClickCount: clickCount });
    console.log(`Click tracked for ${shortUrl}: ${clickCount[shortUrl]}`);
  } catch (error) {
    console.error('Error tracking click:', error);
  }
}

// Listen for tab updates to track when short URLs are opened
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    // Check if it's one of our shortened URLs
    const knownShorteners = ['is.gd', 'v.gd', 'tinyurl.com'];
    const isShortUrl = knownShorteners.some(shortener => tab.url.includes(shortener));
    
    if (isShortUrl) {
      // Extract the short URL
      const shortUrl = tab.url.split('?')[0]; // Remove query params if any
      trackShortUrlClick(shortUrl);
    }
  }
});

// Handle context menu clicks for sharing
chrome.contextMenus.create({
  id: 'shorten-url',
  title: 'Shorten this link',
  contexts: ['link']
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'shorten-url') {
    console.log('Context menu shorten:', info.linkUrl);
  }
});

// Message listener with proper async handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);
  
  // Handle async operations properly
  (async () => {
    try {
      if (request.action === 'fetchMetadata') {
        console.log('Fetching metadata for:', request.url);
        const metadata = await fetchPageMetadataFromUrl(request.url);
        sendResponse({ success: true, metadata });
      } 
      else if (request.action === 'shortenUrl') {
        console.log('Shortening URL:', request.url);
        const shortUrl = await shortenUrl(request.url);
        sendResponse({ success: true, shortUrl });
      } 
      else if (request.action === 'resolveShortUrl') {
        console.log('Resolving short URL:', request.shortUrl);
        const originalUrl = await resolveShortUrl(request.shortUrl);
        sendResponse({ success: true, originalUrl });
      }
      else {
        sendResponse({ success: false, error: 'Unknown action: ' + request.action });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep channel open for async response
});

// Resolve shortened URL to original URL
async function resolveShortUrl(shortUrl) {
  try {
    console.log('Resolving short URL:', shortUrl);
    const response = await fetch(shortUrl, {
      method: 'HEAD',
      redirect: 'follow'
    });
    
    const finalUrl = response.url;
    console.log('Resolved to:', finalUrl);
    return finalUrl;
  } catch (error) {
    console.error('Error resolving short URL:', error);
    throw error;
  }
}

// Log when service worker starts
console.log('Background service worker started at:', new Date().toISOString());