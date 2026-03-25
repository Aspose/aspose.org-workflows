/**
 * @fileoverview Enhanced module for fetching and parsing sitemap XML files with better error handling, retry logic, and performance optimization.
 */
class SitemapParser {
  constructor() {
    this.requestCache = new Map();
    this.cacheExpiry = 10 * 60 * 1000; // 10 minutes
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
  }

  /**
   * Fetches and parses a sitemap or sitemap index URL to extract URLs with enhanced error handling
   * @param {string} sitemapUrl The URL of the sitemap.
   * @param {string[]} sitemapQueue The queue to add child sitemaps to.
   * @return {Object} An object with type, urls, and childCount information.
   */
  fetchAndParseSitemap(sitemapUrl, sitemapQueue) {
    if (!sitemapUrl || typeof sitemapUrl !== 'string') {
      Logger.log(`ERROR: Invalid sitemap URL provided: ${sitemapUrl}`);
      return { type: 'error', urls: [], childCount: 0, error: 'Invalid URL' };
    }

    if (!Array.isArray(sitemapQueue)) {
      Logger.log(`ERROR: Invalid sitemap queue provided`);
      return { type: 'error', urls: [], childCount: 0, error: 'Invalid queue' };
    }

    const cleanUrl = sitemapUrl.trim();
    Logger.log(`Fetching sitemap: ${cleanUrl}`);

    // Check cache first
    const cacheKey = this.getCacheKey(cleanUrl);
    const cachedResult = this.getCachedResult(cacheKey);
    if (cachedResult) {
      Logger.log(`Using cached result for: ${cleanUrl}`);
      return cachedResult;
    }

    let lastError = null;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        Logger.log(`Attempt ${attempt}/${this.maxRetries} for: ${cleanUrl}`);
        
        const response = this.fetchWithRetry(cleanUrl, attempt);
        
        if (!response) {
          lastError = new Error(`Failed to fetch after ${attempt} attempts`);
          continue;
        }
        
        const result = this.parseXmlResponse(response, cleanUrl, sitemapQueue);
        
        // Cache successful results
        if (result.type !== 'error') {
          this.setCachedResult(cacheKey, result);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        Logger.log(`Attempt ${attempt} failed for ${cleanUrl}: ${error.message}`);
        
        if (attempt < this.maxRetries) {
          const delay = this.calculateDelay(attempt);
          Logger.log(`Waiting ${delay}ms before retry...`);
          Utilities.sleep(delay);
        }
      }
    }

    Logger.log(`All attempts failed for sitemap: ${cleanUrl}`);
    return { 
      type: 'error', 
      urls: [], 
      childCount: 0, 
      error: lastError ? lastError.message : 'Unknown error'
    };
  }

  /**
   * Fetches a sitemap URL with enhanced error handling and validation
   */
  fetchWithRetry(sitemapUrl, attemptNumber) {
    try {
      // Validate URL format
      if (!this.isValidSitemapUrl(sitemapUrl)) {
        throw new Error(`Invalid sitemap URL format: ${sitemapUrl}`);
      }

      const fetchOptions = {
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SitemapParser/1.0; Google Apps Script)',
          'Accept': 'application/xml,text/xml,*/*'
        }
      };

      // Add timeout based on attempt number
      const timeout = Math.min(30000, 10000 + (attemptNumber * 5000));
      fetchOptions.timeout = timeout;

      const response = UrlFetchApp.fetch(sitemapUrl, fetchOptions);
      const responseCode = response.getResponseCode();
      
      Logger.log(`HTTP ${responseCode} for: ${sitemapUrl}`);
      
      // Handle different response codes
      if (responseCode === 200) {
        const contentType = response.getHeaders()['Content-Type'] || '';
        const contentLength = response.getHeaders()['Content-Length'];
        
        Logger.log(`Content-Type: ${contentType}, Length: ${contentLength || 'unknown'}`);
        
        // Validate content type
        if (!this.isValidContentType(contentType)) {
          Logger.log(`WARNING: Unexpected content type: ${contentType}`);
        }
        
        return response;
        
      } else if (responseCode === 404) {
        Logger.log(`Sitemap not found (404): ${sitemapUrl}`);
        return null;
        
      } else if (responseCode === 403) {
        Logger.log(`Access forbidden (403): ${sitemapUrl}`);
        return null;
        
      } else if (responseCode >= 500 && responseCode < 600) {
        throw new Error(`Server error ${responseCode} - retryable`);
        
      } else if (responseCode === 429) {
        throw new Error(`Rate limited (429) - retryable`);
        
      } else {
        throw new Error(`HTTP ${responseCode} - non-retryable`);
      }
      
    } catch (error) {
      if (error.message.includes('retryable')) {
        throw error; // Re-throw retryable errors
      } else if (error.message.includes('timeout')) {
        throw new Error(`Request timeout - retryable`);
      } else {
        Logger.log(`Non-retryable error for ${sitemapUrl}: ${error.message}`);
        return null;
      }
    }
  }

  /**
   * Parses XML response and extracts URLs or child sitemaps
   */
  parseXmlResponse(response, sitemapUrl, sitemapQueue) {
    try {
      const content = response.getContentText();
      
      if (!content || content.trim() === '') {
        Logger.log(`Empty content for sitemap: ${sitemapUrl}`);
        return { type: 'error', urls: [], childCount: 0, error: 'Empty content' };
      }

      // Basic XML validation
      if (!content.includes('<?xml') && !content.includes('<urlset') && !content.includes('<sitemapindex')) {
        Logger.log(`Content does not appear to be XML: ${sitemapUrl}`);
        return { type: 'error', urls: [], childCount: 0, error: 'Not XML content' };
      }

      // Parse XML with enhanced error handling
      let doc;
      try {
        doc = XmlService.parse(content);
      } catch (parseError) {
        Logger.log(`XML parsing error for ${sitemapUrl}: ${parseError.message}`);
        
        // Try to clean and re-parse XML
        const cleanedContent = this.cleanXmlContent(content);
        if (cleanedContent !== content) {
          try {
            doc = XmlService.parse(cleanedContent);
            Logger.log(`Successfully parsed cleaned XML for: ${sitemapUrl}`);
          } catch (secondError) {
            return { type: 'error', urls: [], childCount: 0, error: `XML parsing failed: ${parseError.message}` };
          }
        } else {
          return { type: 'error', urls: [], childCount: 0, error: `XML parsing failed: ${parseError.message}` };
        }
      }

      const root = doc.getRootElement();
      const rootName = root.getName();
      const namespace = root.getNamespace();
      
      Logger.log(`Parsed XML successfully. Root element: ${rootName}`);

      if (rootName === "sitemapindex") {
        return this.processSitemapIndex(root, namespace, sitemapQueue, sitemapUrl);
      } else if (rootName === "urlset") {
        return this.processUrlSet(root, namespace, sitemapUrl);
      } else {
        Logger.log(`Unknown XML root element: ${rootName} for sitemap: ${sitemapUrl}`);
        return { type: 'unknown', urls: [], childCount: 0, error: `Unknown root: ${rootName}` };
      }
      
    } catch (error) {
      Logger.log(`Error parsing XML response for ${sitemapUrl}: ${error.message}`);
      return { type: 'error', urls: [], childCount: 0, error: error.message };
    }
  }

  /**
   * Process a sitemap index and add child sitemaps to queue with validation
   */
  processSitemapIndex(root, namespace, sitemapQueue, parentUrl) {
    try {
      const sitemapElements = root.getChildren("sitemap", namespace);
      Logger.log(`Found ${sitemapElements.length} sitemap elements in index`);
      
      const childSitemaps = [];
      let validCount = 0;
      let invalidCount = 0;

      sitemapElements.forEach((sitemapElement, index) => {
        try {
          const locElement = sitemapElement.getChild("loc", namespace);
          if (locElement) {
            const childUrl = locElement.getText().trim();
            
            if (this.isValidSitemapUrl(childUrl)) {
              childSitemaps.push(childUrl);
              validCount++;
            } else {
              Logger.log(`Invalid child sitemap URL: ${childUrl}`);
              invalidCount++;
            }
          } else {
            Logger.log(`Missing loc element in sitemap ${index + 1}`);
            invalidCount++;
          }
        } catch (elementError) {
          Logger.log(`Error processing sitemap element ${index + 1}: ${elementError.message}`);
          invalidCount++;
        }
      });

      if (childSitemaps.length > 0) {
        // Add to queue with duplicate checking
        let addedCount = 0;
        childSitemaps.forEach(childUrl => {
          if (!sitemapQueue.includes(childUrl)) {
            sitemapQueue.push(childUrl);
            addedCount++;
          } else {
            Logger.log(`Duplicate sitemap URL skipped: ${childUrl}`);
          }
        });
        
        Logger.log(`Sitemap Index [${parentUrl}]:`);
        Logger.log(`  Found: ${childSitemaps.length} child sitemaps`);
        Logger.log(`  Added to queue: ${addedCount} new sitemaps`);
        Logger.log(`  Valid: ${validCount}, Invalid: ${invalidCount}`);
      }

      return { 
        type: 'sitemapindex', 
        urls: [], 
        childCount: childSitemaps.length,
        validChildren: validCount,
        invalidChildren: invalidCount
      };
      
    } catch (error) {
      Logger.log(`Error processing sitemap index: ${error.message}`);
      return { type: 'error', urls: [], childCount: 0, error: error.message };
    }
  }

  /**
   * Process a URL set sitemap with enhanced validation and filtering
   */
  processUrlSet(root, namespace, sitemapUrl) {
    let urls = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    
    try {
      const urlElements = root.getChildren("url", namespace);
      Logger.log(`Found ${urlElements.length} URL elements in sitemap: ${sitemapUrl}`);
      
      const seenUrls = new Set(); // Track duplicates
      
      urlElements.forEach((urlElement, index) => {
        try {
          const locElement = urlElement.getChild("loc", namespace);
          if (locElement) {
            const url = locElement.getText().trim();
            
            if (this.isValidUrl(url)) {
              if (seenUrls.has(url)) {
                duplicateCount++;
                Logger.log(`Duplicate URL found: ${url}`);
              } else {
                seenUrls.add(url);
                urls.push(url);
                validCount++;
              }
            } else {
              Logger.log(`Invalid URL skipped: ${url}`);
              invalidCount++;
            }
            
            // Optional: Extract additional metadata
            const lastmodElement = urlElement.getChild("lastmod", namespace);
            const changefreqElement = urlElement.getChild("changefreq", namespace);
            const priorityElement = urlElement.getChild("priority", namespace);
            
            // Log metadata for first few URLs
            if (index < 3 && (lastmodElement || changefreqElement || priorityElement)) {
              Logger.log(`URL metadata: ${url}`);
              if (lastmodElement) Logger.log(`  Last modified: ${lastmodElement.getText()}`);
              if (changefreqElement) Logger.log(`  Change frequency: ${changefreqElement.getText()}`);
              if (priorityElement) Logger.log(`  Priority: ${priorityElement.getText()}`);
            }
            
          } else {
            Logger.log(`Missing loc element in URL ${index + 1}`);
            invalidCount++;
          }
        } catch (elementError) {
          Logger.log(`Error processing URL element ${index + 1}: ${elementError.message}`);
          invalidCount++;
        }
      });

    } catch (error) {
      Logger.log(`Error processing URL set: ${error.message}`);
      return { type: 'error', urls: [], childCount: 0, error: error.message };
    }

    Logger.log(`URL extraction summary for ${sitemapUrl}:`);
    Logger.log(`  Total elements: ${validCount + invalidCount}`);
    Logger.log(`  Valid URLs: ${validCount}`);
    Logger.log(`  Invalid URLs: ${invalidCount}`);
    Logger.log(`  Duplicate URLs: ${duplicateCount}`);
    Logger.log(`  Final URL count: ${urls.length}`);
    
    return { 
      type: 'urlset', 
      urls: urls, 
      childCount: 0,
      validUrls: validCount,
      invalidUrls: invalidCount,
      duplicateUrls: duplicateCount
    };
  }
/**
   * Enhanced URL validation (Fixed for Google Apps Script)
   */
  isValidUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    const trimmedUrl = url.trim();
    if (trimmedUrl.length === 0) return false;
    
    // Basic URL format check
    if (!trimmedUrl.startsWith('https://') && !trimmedUrl.startsWith('http://')) {
      return false;
    }
    
    try {
      // Basic URL validation without URL constructor (not available in Apps Script)
      if (!trimmedUrl.match(/^https?:\/\/[^\s/$.?#].[^\s]*$/)) {
        return false;
      }
      
      // Extract hostname manually since URL constructor isn't available
      const urlParts = trimmedUrl.replace(/^https?:\/\//, '').split('/');
      const hostname = urlParts[0];
      
      // Check for valid hostname
      if (!hostname || hostname.length === 0) {
        return false;
      }
      
      // Check for suspicious patterns
      if (trimmedUrl.includes(' ') || 
          trimmedUrl.includes('\n') || 
          trimmedUrl.includes('\t')) {
        return false;
      }
      
      // Check maximum URL length (reasonable limit)
      if (trimmedUrl.length > 2000) {
        Logger.log(`URL too long (${trimmedUrl.length} chars): ${trimmedUrl.substring(0, 100)}...`);
        return false;
      }
      
      return true;
      
    } catch (error) {
      Logger.log(`URL validation error: ${error.message} for URL: ${trimmedUrl}`);
      return false;
    }
  }

  /**
   * Validate sitemap URL format
   */
  isValidSitemapUrl(url) {
    if (!this.isValidUrl(url)) return false;
    
    // Additional sitemap-specific validation
    const lowerUrl = url.toLowerCase();
    
    // Must end with .xml
    if (!lowerUrl.endsWith('.xml')) {
      return false;
    }
    
    // Should contain 'sitemap' in the path (flexible check)
    if (!lowerUrl.includes('sitemap')) {
      Logger.log(`WARNING: URL doesn't contain 'sitemap': ${url}`);
      // Don't reject, just warn
    }
    
    return true;
  }
  
  /**
   * Validate response content type
   */
  isValidContentType(contentType) {
    if (!contentType) return true; // Allow missing content type
    
    const validTypes = [
      'text/xml',
      'application/xml',
      'application/rss+xml',
      'application/atom+xml',
      'text/plain'
    ];
    
    const lowerContentType = contentType.toLowerCase();
    return validTypes.some(validType => lowerContentType.includes(validType));
  }

  /**
   * Clean XML content to handle common issues
   */
  cleanXmlContent(content) {
    if (!content || typeof content !== 'string') return content;
    
    let cleaned = content;
    
    // Remove BOM (Byte Order Mark) if present
    if (cleaned.charCodeAt(0) === 0xFEFF) {
      cleaned = cleaned.substring(1);
    }
    
    // Trim whitespace
    cleaned = cleaned.trim();
    
    // Fix common encoding issues
    cleaned = cleaned.replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, '&amp;');
    
    // Remove null characters
    cleaned = cleaned.replace(/\0/g, '');
    
    // Basic XML declaration fix
    if (!cleaned.startsWith('<?xml')) {
      cleaned = '<?xml version="1.0" encoding="UTF-8"?>\n' + cleaned;
    }
    
    return cleaned;
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateDelay(attemptNumber) {
    const exponentialDelay = this.baseDelay * Math.pow(2, attemptNumber - 1);
    const jitter = Math.random() * 1000; // Add randomness to avoid thundering herd
    return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
  }

  /**
   * Generate cache key for URL
   */
  getCacheKey(url) {
    return `sitemap_${url.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  /**
   * Get cached result if available and not expired
   */
  getCachedResult(cacheKey) {
    if (!this.requestCache.has(cacheKey)) return null;
    
    const cached = this.requestCache.get(cacheKey);
    const now = Date.now();
    
    if (now - cached.timestamp > this.cacheExpiry) {
      this.requestCache.delete(cacheKey);
      return null;
    }
    
    return cached.result;
  }

  /**
   * Cache successful result
   */
  setCachedResult(cacheKey, result) {
    this.requestCache.set(cacheKey, {
      result: result,
      timestamp: Date.now()
    });
    
    // Cleanup old cache entries
    if (this.requestCache.size > 100) {
      const now = Date.now();
      for (const [key, value] of this.requestCache.entries()) {
        if (now - value.timestamp > this.cacheExpiry) {
          this.requestCache.delete(key);
        }
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    Logger.log(`Clearing sitemap parser cache (${this.requestCache.size} entries)`);
    this.requestCache.clear();
  }

  /**
   * Get parser statistics
   */
  getStats() {
    return {
      cacheSize: this.requestCache.size,
      cacheHitRate: this.cacheHits / Math.max(this.totalRequests, 1),
      maxRetries: this.maxRetries,
      baseDelay: this.baseDelay
    };
  }

  /**
   * Test sitemap accessibility without full parsing
   */
  testSitemapAccess(sitemapUrl) {
    Logger.log(`Testing access to: ${sitemapUrl}`);
    
    try {
      if (!this.isValidSitemapUrl(sitemapUrl)) {
        return { accessible: false, error: 'Invalid sitemap URL format' };
      }

      const response = UrlFetchApp.fetch(sitemapUrl, {
        method: 'GET',
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SitemapParser/1.0; Google Apps Script)',
          'Accept': 'application/xml,text/xml,*/*'
        }
      });

      const responseCode = response.getResponseCode();
      const contentType = response.getHeaders()['Content-Type'] || '';
      const contentLength = response.getHeaders()['Content-Length'];

      Logger.log(`Test result: HTTP ${responseCode}, Type: ${contentType}, Length: ${contentLength || 'unknown'}`);

      return {
        accessible: responseCode === 200,
        responseCode: responseCode,
        contentType: contentType,
        contentLength: contentLength,
        error: responseCode !== 200 ? `HTTP ${responseCode}` : null
      };

    } catch (error) {
      Logger.log(`Test failed for ${sitemapUrl}: ${error.message}`);
      return { accessible: false, error: error.message };
    }
  }

  /**
   * Batch test multiple sitemaps
   */
  batchTestSitemaps(sitemapUrls) {
    if (!Array.isArray(sitemapUrls) || sitemapUrls.length === 0) {
      Logger.log('No sitemap URLs provided for batch testing');
      return [];
    }

    Logger.log(`Batch testing ${sitemapUrls.length} sitemaps`);
    const results = [];

    sitemapUrls.forEach((url, index) => {
      if (index % 10 === 0) {
        Logger.log(`Testing sitemap ${index + 1}/${sitemapUrls.length}`);
      }

      const result = this.testSitemapAccess(url);
      results.push({
        url: url,
        ...result
      });

      // Small delay to avoid rate limiting
      if (index < sitemapUrls.length - 1) {
        Utilities.sleep(100);
      }
    });

    const accessibleCount = results.filter(r => r.accessible).length;
    Logger.log(`Batch test complete: ${accessibleCount}/${sitemapUrls.length} accessible`);

    return results;
  }
}