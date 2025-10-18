// content.js - Enhanced Content Script for Metadata Extraction

console.log('ZIMO Content Script: Loaded');

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractPageMetadata') {
    console.log('Content script: Extracting metadata from page');
    
    try {
      const metadata = extractPageMetadata();
      console.log('Content script: Extracted metadata:', metadata);
      sendResponse({ success: true, metadata });
    } catch (error) {
      console.error('Content script: Error extracting metadata:', error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true;
  }
});

// Main metadata extraction function
function extractPageMetadata() {
  const metadata = {
    title: '',
    description: '',
    image: '',
    favicon: '',
    siteName: '',
    author: '',
    url: window.location.href
  };

  try {
    // Helper: Get meta content by name or property
    const getMetaContent = (selector) => {
      const meta = document.querySelector(selector);
      return meta ? (meta.getAttribute('content') || meta.textContent).trim() : '';
    };

    // Helper: Make URL absolute
    const makeAbsolute = (url) => {
      if (!url) return '';
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('//')) return window.location.protocol + url;
      if (url.startsWith('/')) return window.location.origin + url;
      if (url.startsWith('./')) return window.location.origin + url.substring(1);
      return window.location.origin + '/' + url;
    };

    // ===== EXTRACT TITLE (Priority: OG > Twitter > Document > H1) =====
    const ogTitle = getMetaContent('meta[property="og:title"]');
    const twitterTitle = getMetaContent('meta[name="twitter:title"]');
    const documentTitle = document.title?.trim() || '';
    const h1Title = document.querySelector('h1')?.textContent?.trim() || '';
    
    metadata.title = ogTitle || twitterTitle || documentTitle || h1Title || '';

    // ===== EXTRACT DESCRIPTION (Priority: OG > Meta > Twitter > First Para) =====
    const ogDesc = getMetaContent('meta[property="og:description"]');
    const metaDesc = getMetaContent('meta[name="description"]');
    const twitterDesc = getMetaContent('meta[name="twitter:description"]');
    
    let firstParagraphDesc = '';
    try {
      const paragraphs = document.querySelectorAll('article p, main p, .content p, p');
      for (const p of paragraphs) {
        const text = p.textContent?.trim();
        if (text && text.length > 30 && text.length < 400 && !text.includes('<')) {
          firstParagraphDesc = text;
          break;
        }
      }
    } catch (e) {
      console.log('Error extracting paragraph:', e);
    }
    
    metadata.description = ogDesc || metaDesc || twitterDesc || firstParagraphDesc || '';
    metadata.description = metadata.description.substring(0, 300).trim();

    // ===== EXTRACT IMAGE (Priority: OG > Twitter > First Large Image) =====
    const ogImage = getMetaContent('meta[property="og:image"]');
    const ogImageSecure = getMetaContent('meta[property="og:image:secure_url"]');
    const twitterImage = getMetaContent('meta[name="twitter:image"]');
    const twitterImageSrc = getMetaContent('meta[name="twitter:image:src"]');
    
    let imageUrl = ogImage || ogImageSecure || twitterImage || twitterImageSrc || '';
    
    // If no meta image, find first suitable image
    if (!imageUrl) {
      try {
        const images = document.querySelectorAll('img[src], img[data-src]');
        for (const img of images) {
          const src = img.src || img.getAttribute('data-src');
          
          // Skip tracking pixels, icons, logos
          if (!src || src.includes('pixel') || src.includes('track') || 
              src.includes('icon') || src.includes('logo') || src.includes('avatar') ||
              src.includes('data:') || src.length < 10) {
            continue;
          }
          
          const width = img.naturalWidth || img.offsetWidth || 0;
          const height = img.naturalHeight || img.offsetHeight || 0;
          
          if (width > 100 && height > 100) {
            imageUrl = src;
            break;
          }
        }
      } catch (e) {
        console.log('Error finding image:', e);
      }
    }
    
    metadata.image = makeAbsolute(imageUrl);

    // ===== EXTRACT FAVICON =====
    const iconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',
      'link[rel="mask-icon"]'
    ];
    
    let faviconUrl = '';
    for (const selector of iconSelectors) {
      const link = document.querySelector(selector);
      if (link?.href) {
        faviconUrl = link.href;
        break;
      }
    }
    
    // Fallback to standard favicon location
    if (!faviconUrl) {
      faviconUrl = window.location.origin + '/favicon.ico';
    } else {
      faviconUrl = makeAbsolute(faviconUrl);
    }
    
    metadata.favicon = faviconUrl;

    // ===== EXTRACT ADDITIONAL METADATA =====
    metadata.siteName = getMetaContent('meta[property="og:site_name"]');
    metadata.author = getMetaContent('meta[name="author"]') || 
                     getMetaContent('meta[property="article:author"]') ||
                     getMetaContent('meta[name="twitter:creator"]');

    // Canonical URL
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical?.href) {
      metadata.canonicalUrl = canonical.href;
    }

    // Language
    const htmlLang = document.documentElement.getAttribute('lang') || 
                    getMetaContent('meta[http-equiv="content-language"]');
    if (htmlLang) {
      metadata.language = htmlLang.split('-')[0];
    }

    // Published time
    metadata.publishedTime = getMetaContent('meta[property="article:published_time"]') ||
                            getMetaContent('meta[itemprop="datePublished"]');

    // Clean up all strings
    Object.keys(metadata).forEach(key => {
      if (typeof metadata[key] === 'string') {
        metadata[key] = metadata[key].trim();
      }
    });

    console.log('✓ Metadata extracted successfully:', {
      title: metadata.title ? '✓' : '✗',
      description: metadata.description ? '✓' : '✗',
      image: metadata.image && metadata.image.startsWith('http') ? '✓' : '✗',
      favicon: metadata.favicon && metadata.favicon.startsWith('http') ? '✓' : '✗'
    });

  } catch (error) {
    console.error('Error in extractPageMetadata:', error);
    
    // Fallback extraction
    try {
      metadata.title = document.title || 'Untitled';
      metadata.favicon = window.location.origin + '/favicon.ico';
    } catch (e) {
      console.error('Fallback error:', e);
    }
  }

  return metadata;
}

// Auto-extract metadata on page load
function initializeMetadataExtraction() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('Content script: DOM loaded - caching metadata');
      setTimeout(() => extractPageMetadata(), 500);
    });
  } else {
    console.log('Content script: Page ready - caching metadata');
    setTimeout(() => extractPageMetadata(), 300);
  }
}

// Initialize
initializeMetadataExtraction();

// Handle SPA navigation
let lastUrl = window.location.href;
new MutationObserver(() => {
  const url = window.location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('Content script: URL changed - re-extracting metadata');
    setTimeout(() => extractPageMetadata(), 1000);
  }
}).observe(document, { subtree: true, childList: true });

// Export for debugging
window.ZIMOMetadata = {
  extract: extractPageMetadata
};

console.log('ZIMO Content Script: Ready');