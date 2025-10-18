// content.js - Content Script for Metadata Extraction

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

// Extract metadata from the current page
function extractPageMetadata() {
  const metadata = {
    title: '',
    description: '',
    image: '',
    favicon: '',
    siteName: '',
    author: ''
  };

  try {
    // Helper function to get meta content
    const getMetaContent = (name, property = false) => {
      if (property) {
        const meta = document.querySelector(`meta[property="${name}"]`);
        return meta ? meta.content : '';
      } else {
        const meta = document.querySelector(`meta[name="${name}"]`);
        return meta ? meta.content : '';
      }
    };

    // Helper function to make URL absolute
    const makeUrlAbsolute = (url) => {
      if (!url) return '';
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      if (url.startsWith('//')) return window.location.protocol + url;
      if (url.startsWith('/')) return window.location.origin + url;
      return window.location.origin + '/' + url.replace(/^\.?\//, '');
    };

    // Extract title (multiple sources, prioritized)
    const ogTitle = getMetaContent('og:title', true);
    const twitterTitle = getMetaContent('twitter:title', true);
    const titleTag = document.querySelector('title');
    const h1Tag = document.querySelector('h1');
    
    metadata.title = ogTitle || 
                     twitterTitle || 
                     (titleTag?.textContent?.trim()) ||
                     (h1Tag?.textContent?.trim()) ||
                     document.title || 
                     '';

    // If no title found, try to create one from URL
    if (!metadata.title) {
      try {
        const url = new URL(window.location.href);
        const domain = url.hostname.replace('www.', '');
        const path = url.pathname.split('/').filter(p => p).join(' - ');
        metadata.title = path ? `${domain} - ${path}` : domain;
      } catch (e) {
        metadata.title = 'Untitled Page';
      }
    }

    // Extract description (multiple sources)
    const ogDesc = getMetaContent('og:description', true);
    const twitterDesc = getMetaContent('twitter:description', true);
    const metaDesc = getMetaContent('description', false);
    
    // Try to get description from first meaningful paragraph
    let firstParagraph = '';
    const paragraphs = document.querySelectorAll('p');
    for (let p of paragraphs) {
      const text = p.textContent.trim();
      if (text.length > 50 && text.length < 300) {
        firstParagraph = text;
        break;
      }
    }

    metadata.description = ogDesc || 
                          twitterDesc || 
                          metaDesc ||
                          firstParagraph ||
                          '';

    // Clean up description
    metadata.description = metadata.description.replace(/\s+/g, ' ').trim().substring(0, 300);

    // Extract image (multiple sources)
    const ogImage = getMetaContent('og:image', true);
    const twitterImage = getMetaContent('twitter:image', true);
    const ogImageUrl = getMetaContent('og:image:url', true);
    const twitterImageSrc = getMetaContent('twitter:image:src', true);
    
    let imageUrl = ogImage || 
                   twitterImage || 
                   ogImageUrl ||
                   twitterImageSrc ||
                   '';

    // Make image URL absolute
    metadata.image = makeUrlAbsolute(imageUrl);

    // If no OG image found, try to find the first large image on the page
    if (!metadata.image) {
      const images = document.querySelectorAll('img[src]');
      for (let img of images) {
        const src = img.getAttribute('src');
        // Check if it's a reasonable image (not too small, not a tracking pixel)
        if (src && !src.includes('pixel') && !src.includes('track') && 
            !src.includes('icon') && !src.includes('logo')) {
          const width = img.naturalWidth || img.offsetWidth;
          const height = img.naturalHeight || img.offsetHeight;
          if (width > 100 && height > 100) {
            metadata.image = makeUrlAbsolute(src);
            break;
          }
        }
      }
    }

    // Extract favicon (multiple possible locations)
    const iconSelectors = [
      'link[rel="icon"]',
      'link[rel="shortcut icon"]',
      'link[rel="apple-touch-icon"]',
      'link[rel="apple-touch-icon-precomposed"]',
      'link[rel="mask-icon"]',
      'link[rel="fluid-icon"]'
    ];

    let faviconUrl = '';
    for (let selector of iconSelectors) {
      const link = document.querySelector(selector);
      if (link?.href) {
        faviconUrl = link.href;
        break;
      }
    }

    // If no favicon found in meta tags, try default locations
    if (!faviconUrl) {
      faviconUrl = `${window.location.origin}/favicon.ico`;
    } else {
      faviconUrl = makeUrlAbsolute(faviconUrl);
    }

    metadata.favicon = faviconUrl;

    // Extract additional metadata
    metadata.siteName = getMetaContent('og:site_name', true) || '';
    metadata.author = getMetaContent('author', false) || 
                     getMetaContent('twitter:creator', true) || 
                     '';

    // Extract canonical URL
    const canonicalLink = document.querySelector('link[rel="canonical"]');
    if (canonicalLink?.href) {
      metadata.canonicalUrl = canonicalLink.href;
    }

    // Extract language
    const htmlLang = document.documentElement.getAttribute('lang');
    if (htmlLang) {
      metadata.language = htmlLang;
    }

    // Extract published time if available
    const publishedTime = getMetaContent('article:published_time', true) ||
                         getMetaContent('og:published_time', true);
    if (publishedTime) {
      metadata.publishedTime = publishedTime;
    }

    console.log('Content script: Successfully extracted metadata:', {
      title: metadata.title,
      description: metadata.description ? metadata.description.substring(0, 100) + '...' : 'empty',
      image: metadata.image ? '✓' : '✗',
      favicon: metadata.favicon ? '✓' : '✗'
    });

  } catch (error) {
    console.error('Content script: Error in extractPageMetadata:', error);
    
    // Fallback: return at least basic information
    metadata.title = document.title || 'Untitled Page';
    metadata.favicon = `${window.location.origin}/favicon.ico`;
    
    try {
      const url = new URL(window.location.href);
      const domain = url.hostname.replace('www.', '');
      if (!metadata.title || metadata.title === 'Untitled Page') {
        metadata.title = domain;
      }
    } catch (e) {
      // Ignore URL parsing errors
    }
  }

  return metadata;
}

// Enhanced metadata extraction for specific content types
function extractEnhancedMetadata() {
  const enhanced = {
    isArticle: false,
    readingTime: 0,
    wordCount: 0
  };

  try {
    // Check if it's an article
    const article = document.querySelector('article');
    if (article) {
      enhanced.isArticle = true;
      
      // Calculate reading time
      const text = article.textContent || '';
      const wordCount = text.split(/\s+/).length;
      enhanced.wordCount = wordCount;
      enhanced.readingTime = Math.ceil(wordCount / 200); // 200 words per minute
    }

    // Check for schema.org markup
    const schemaScripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (let script of schemaScripts) {
      try {
        const schema = JSON.parse(script.textContent);
        if (schema['@type'] === 'Article' || schema['@type'] === 'NewsArticle') {
          enhanced.isArticle = true;
          if (schema.headline) enhanced.schemaTitle = schema.headline;
          if (schema.description) enhanced.schemaDescription = schema.description;
          if (schema.image) enhanced.schemaImage = schema.image;
          if (schema.datePublished) enhanced.schemaPublished = schema.datePublished;
          break;
        }
      } catch (e) {
        // Ignore JSON parsing errors
      }
    }
  } catch (error) {
    console.error('Content script: Error in extractEnhancedMetadata:', error);
  }

  return enhanced;
}

// Auto-extract and cache metadata on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Content script: DOM loaded - extracting metadata');
    // Cache metadata for potential future use
    setTimeout(() => {
      const metadata = extractPageMetadata();
      const enhanced = extractEnhancedMetadata();
      console.log('Content script: Auto-extracted metadata cached');
    }, 1000);
  });
} else {
  // DOM already loaded
  console.log('Content script: Page already loaded - extracting metadata');
  setTimeout(() => {
    const metadata = extractPageMetadata();
    const enhanced = extractEnhancedMetadata();
    console.log('Content script: Auto-extracted metadata cached');
  }, 500);
}

// Listen for page changes (SPA navigation)
let lastUrl = window.location.href;
new MutationObserver(() => {
  const url = window.location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    console.log('Content script: URL changed, re-extracting metadata');
    setTimeout(() => {
      const metadata = extractPageMetadata();
      console.log('Content script: Re-extracted metadata after navigation');
    }, 1000);
  }
}).observe(document, { subtree: true, childList: true });

// Export functions for direct access (if needed)
window.ZIMOContentScript = {
  extractPageMetadata,
  extractEnhancedMetadata
};

console.log('Content script: ZIMO URL Shortener content script loaded');