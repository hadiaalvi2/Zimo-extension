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
          console.log(`${service.name} shortened successfully:`, shortUrl.trim());
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
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
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

    // Resolve image URL to absolute if relative
    let resolvedImage = image;
    if (image && !image.startsWith('http')) {
      try {
        resolvedImage = new URL(image, url).href;
      } catch (e) {
        const urlObj = new URL(url);
        resolvedImage = urlObj.origin + (image.startsWith('/') ? image : '/' + image);
      }
    }

    // Get video metadata if available
    const video = getMetaContent([
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[property="og:video:secure_url"]'
    ]);

    // Get additional Open Graph metadata
    const type = getMetaContent(['meta[property="og:type"]']) || 'website';
    const locale = getMetaContent(['meta[property="og:locale"]']) || 'en_US';

    const metadata = {
      title: cleanText(title),
      description: cleanText(description) || '',
      siteName: cleanText(siteName) || '',
      image: resolvedImage || '',
      favicon: favicon,
      video: video || '',
      url: url,
      type: type,
      locale: locale
    };

    console.log('Background: Fetched complete metadata:', {
      title: metadata.title,
      hasDescription: !!metadata.description,
      hasImage: !!metadata.image,
      hasFavicon: !!metadata.favicon,
      type: metadata.type
    });
    
    return metadata;
  } catch (error) {
    console.error('Background: Error fetching metadata from URL:', error);
    
    // Try to extract basic info from URL
    let title = 'Untitled Page';
    try {
      const urlObj = new URL(url);
      title = urlObj.hostname.replace('www.', '');
    } catch (e) {}
    
    return {
      title: title,
      description: '',
      siteName: '',
      image: '',
      favicon: '',
      video: '',
      url: url,
      type: 'website',
      locale: 'en_US'
    };
  }
}

// ENHANCED: Special YouTube metadata fetcher with better error handling
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
    } else if (url.includes('youtube.com/shorts/')) {
      videoId = url.split('youtube.com/shorts/')[1]?.split('?')[0];
    }
    
    if (!videoId) {
      throw new Error('Could not extract YouTube video ID');
    }
    
    console.log('YouTube Video ID:', videoId);
    
    // Fetch the YouTube page with proper headers
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
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
    
    // Extract title - YouTube specific
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
    
    // YouTube thumbnail (maxresdefault is the highest quality)
    const thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    
    // Backup thumbnail URLs
    const thumbnailHQ = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const thumbnailMQ = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    
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
      thumbnailHQ: thumbnailHQ,
      thumbnailMQ: thumbnailMQ,
      type: 'video.other'
    };
    
    console.log('YouTube metadata extracted:', {
      title: metadata.title,
      channel: metadata.channel,
      videoId: metadata.videoId,
      hasDescription: !!metadata.description
    });
    
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
      } else if (url.includes('youtube.com/shorts/')) {
        videoId = url.split('youtube.com/shorts/')[1]?.split('?')[0];
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
      videoId: videoId || '',
      type: 'video.other'
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


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.action);
  
  // Handle async operations properly
  (async () => {
    try {
      if (request.action === 'fetchMetadata') {
        console.log('Fetching metadata for ORIGINAL URL:', request.url);
        const metadata = await fetchPageMetadataFromUrl(request.url);
        console.log('Metadata fetched successfully:', {
          title: metadata.title,
          hasDescription: !!metadata.description,
          hasImage: !!metadata.image
        });
        sendResponse({ success: true, metadata });
      } 
      else if (request.action === 'shortenUrl') {
        console.log('Shortening URL:', request.url);
        const shortUrl = await shortenUrl(request.url);
        console.log('URL shortened successfully:', shortUrl);
        sendResponse({ success: true, shortUrl });
      } 
      else if (request.action === 'resolveShortUrl') {
        console.log('Resolving short URL:', request.shortUrl);
        const originalUrl = await resolveShortUrl(request.shortUrl);
        console.log('Short URL resolved to:', originalUrl);
        sendResponse({ success: true, originalUrl });
      }
      else if (request.action === 'shortenAndFetchMetadata') {
        console.log('Shortening and fetching metadata for:', request.url);
        // First fetch metadata from original URL
        const metadata = await fetchPageMetadataFromUrl(request.url);
        console.log('Metadata fetched:', metadata.title);
        // Then shorten the URL
        const shortUrl = await shortenUrl(request.url);
        console.log('URL shortened:', shortUrl);
        sendResponse({ success: true, shortUrl, metadata });
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

async function verifyShortUrlRedirect(shortUrl, expectedOriginalUrl) {
  try {
    console.log('Verifying short URL redirect...');
    const resolvedUrl = await resolveShortUrl(shortUrl);
    const isProperRedirect = resolvedUrl === expectedOriginalUrl;
    console.log('Redirect verification:', { shortUrl, resolvedUrl, expectedOriginalUrl, isProperRedirect });
    return isProperRedirect;
  } catch (error) {
    console.error('Error verifying redirect:', error);
    return false;
  }
}

// Log when service worker starts
console.log('Background service worker started at:', new Date().toISOString());
console.log('Ready to fetch metadata from ORIGINAL URLs for proper sharing previews');