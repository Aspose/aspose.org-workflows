/**
 * @fileoverview Enhanced module for handling all indexing API submissions with better error handling, retry logic, and detailed logging.
 */
class IndexingAPI {

  /**
   * Submits URLs to IndexNow API for multiple search engines with enhanced error handling
   */
  submitToIndexNow(engine, urls, hostDomain) {
    if (!engine || !urls || !Array.isArray(urls) || urls.length === 0) {
      Logger.log(`❌ ERROR: Invalid parameters for ${engine || 'unknown'} submission`);
      return { success: false, submittedUrls: [], error: "Invalid parameters" };
    }

    const endpoint = INDEXNOW_ENDPOINTS[engine];
    const apiKey = INDEXNOW_KEYS[engine];

    if (!endpoint) {
      Logger.log(`❌ ERROR: Missing endpoint for ${engine}`);
      return { success: false, submittedUrls: [], error: "Missing endpoint" };
    }

    if (!apiKey) {
      Logger.log(`❌ ERROR: Missing API key for ${engine}`);
      return { success: false, submittedUrls: [], error: "Missing API key" };
    }

    if (!hostDomain) {
      Logger.log(`❌ ERROR: Missing host domain for ${engine}`);
      return { success: false, submittedUrls: [], error: "Missing host domain" };
    }

    Logger.log(`📤 Submitting ${urls.length} URLs to ${engine.toUpperCase()} for domain: ${hostDomain}`);
    
    const payload = {
      "host": hostDomain,
      "key": apiKey,
      "keyLocation": `https://${hostDomain}/${apiKey}.txt`,
      "urlList": urls
    };

    const options = {
      "method": "POST",
      "contentType": "application/json; charset=utf-8",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
      try {
        Logger.log(`🔄 Attempt ${retryCount + 1}/${maxRetries} for ${engine.toUpperCase()}`);
        
        const response = UrlFetchApp.fetch(endpoint, options);
        const responseCode = response.getResponseCode();
        const responseText = response.getContentText();
        
        // Success codes
        if (responseCode === 200 || responseCode === 202) {
          Logger.log(`✅ SUCCESS: Submitted ${urls.length} URLs to ${engine.toUpperCase()} - Response Code: ${responseCode}`);
          return { success: true, submittedUrls: urls, responseCode: responseCode };
        }
        
        // Rate limiting - wait and retry
        if (responseCode === 429) {
          retryCount++;
          if (retryCount < maxRetries) {
            const waitTime = Math.pow(2, retryCount) * 1000; // Exponential backoff
            Logger.log(`⏳ RATE LIMITED: Waiting ${waitTime}ms before retry ${retryCount + 1}`);
            Utilities.sleep(waitTime);
            continue;
          } else {
            Logger.log(`❌ FAILED: ${engine.toUpperCase()} rate limit exceeded after ${maxRetries} attempts`);
            return { success: false, submittedUrls: [], error: `Rate limit exceeded: HTTP ${responseCode}` };
          }
        }
        
        // Server errors - retry
        if (responseCode >= 500 && responseCode < 600) {
          retryCount++;
          if (retryCount < maxRetries) {
            const waitTime = 2000 * retryCount;
            Logger.log(`⏳ SERVER ERROR: HTTP ${responseCode}, waiting ${waitTime}ms before retry`);
            Utilities.sleep(waitTime);
            continue;
          }
        }
        
        // Client errors or other failures - don't retry
        Logger.log(`❌ FAILED: ${engine.toUpperCase()} submission failed - Response Code: ${responseCode}`);
        if (responseText) {
          Logger.log(`Response: ${responseText.substring(0, 500)}${responseText.length > 500 ? '...' : ''}`);
        }
        return { success: false, submittedUrls: [], error: `HTTP ${responseCode}: ${responseText}` };
        
      } catch (e) {
        retryCount++;
        Logger.log(`❌ ERROR: Exception during ${engine.toUpperCase()} submission attempt ${retryCount}: ${e.message}`);
        
        if (retryCount < maxRetries) {
          const waitTime = 1000 * retryCount;
          Logger.log(`⏳ Waiting ${waitTime}ms before retry due to exception`);
          Utilities.sleep(waitTime);
        } else {
          Logger.log(`❌ FAILED: ${engine.toUpperCase()} submission failed after ${maxRetries} attempts`);
          return { success: false, submittedUrls: [], error: `Exception after retries: ${e.message}` };
        }
      }
    }
    
    return { success: false, submittedUrls: [], error: "Max retries exceeded" };
  }

/**
 * Submits a batch of URLs to Google Indexing API with enhanced individual URL tracking
 */
submitBatchGoogle(urls, token) {
  if (!Array.isArray(urls) || urls.length === 0) {
    Logger.log("⚠️ ERROR: No valid URLs provided for Google batch submission");
    return { success: false, submittedUrls: [], rateLimited: false };
  }

  if (!token) {
    Logger.log("⚠️ ERROR: No access token provided for Google submission");
    return { success: false, submittedUrls: [], rateLimited: false };
  }

  Logger.log(`📤 Submitting ${urls.length} URLs to GOOGLE INDEXING API`);
  
  // Log sample URLs for debugging
  const sampleCount = Math.min(3, urls.length);
  Logger.log(`📋 Sample URLs:`);
  for (let i = 0; i < sampleCount; i++) {
    Logger.log(`   ${i + 1}. ${urls[i]}`);
  }

  const endpoint = "https://indexing.googleapis.com/batch";
  const boundary = "batch_google_indexing_" + Date.now();
  let batchBody = "";

  // Build batch request with explicit item tracking
  urls.forEach((url, index) => {
    batchBody += `--${boundary}\n`;
    batchBody += "Content-Type: application/http\n";
    batchBody += `Content-ID: <item${index}>\n\n`;
    batchBody += "POST /v3/urlNotifications:publish HTTP/1.1\n";
    batchBody += "Content-Type: application/json\n\n";
    batchBody += JSON.stringify({ "url": url, "type": "URL_UPDATED" }) + "\n\n";
  });
  batchBody += `--${boundary}--`;

  const options = {
    "method": "post",
    "contentType": `multipart/mixed; boundary=${boundary}`,
    "headers": { "Authorization": `Bearer ${token}` },
    "payload": batchBody,
    "muteHttpExceptions": true
  };

  let retryCount = 0;
  const maxRetries = 2;

  while (retryCount < maxRetries) {
    try {
      Logger.log(`🔄 Google API attempt ${retryCount + 1}/${maxRetries}`);
      
      const response = UrlFetchApp.fetch(endpoint, options);
      const responseText = response.getContentText();
      const responseCode = response.getResponseCode();
      
      Logger.log(`📊 Google batch submission response code: ${responseCode}`);
      
      // Check for rate limiting first
      if (responseCode === 429) {
        Logger.log("⚠️ RATE LIMIT: Google Indexing API rate limit reached");
        return { success: false, submittedUrls: [], rateLimited: true };
      }

      // Check for quota exceeded
      if (responseCode === 403) {
        const isQuotaError = responseText && (
          responseText.includes("quotaExceeded") || 
          responseText.includes("dailyLimitExceeded") ||
          responseText.includes("rateLimitExceeded")
        );
        
        if (isQuotaError) {
          Logger.log("⚠️ QUOTA EXCEEDED: Google Indexing API quota exceeded");
          return { success: false, submittedUrls: [], rateLimited: true };
        }
        
        Logger.log(`⚠️ FORBIDDEN (403): ${responseText.substring(0, 500)}`);
        return { success: false, submittedUrls: [], rateLimited: false, error: "Forbidden" };
      }

      // Check for authentication errors
      if (responseCode === 401) {
        Logger.log("⚠️ AUTHENTICATION ERROR: Google API token invalid or expired");
        return { success: false, submittedUrls: [], rateLimited: false, error: "Authentication failed" };
      }
      
      if (responseCode === 200) {
        return this.parseGoogleBatchResponse(responseText, urls, boundary);
      }
      
      // Server errors - retry
      if (responseCode >= 500 && responseCode < 600) {
        retryCount++;
        if (retryCount < maxRetries) {
          const waitTime = 2000 * retryCount;
          Logger.log(`⏳ SERVER ERROR: HTTP ${responseCode}, waiting ${waitTime}ms before retry`);
          Utilities.sleep(waitTime);
          continue;
        }
      }
      
      Logger.log(`⚠️ FAILED: Batch submission failed with code ${responseCode}`);
      Logger.log(`Response preview: ${responseText.substring(0, 1000)}`);
      return { success: false, submittedUrls: [], rateLimited: false };
      
    } catch (e) {
      retryCount++;
      Logger.log(`⚠️ ERROR: Exception during Google submission attempt ${retryCount}: ${e.message}`);
      
      if (retryCount < maxRetries) {
        const waitTime = 1000 * retryCount;
        Logger.log(`⏳ Waiting ${waitTime}ms before retry due to exception`);
        Utilities.sleep(waitTime);
      } else {
        Logger.log(`⚠️ FAILED: Google submission failed after ${maxRetries} attempts`);
        return { success: false, submittedUrls: [], rateLimited: false };
      }
    }
  }
  
  return { success: false, submittedUrls: [], rateLimited: false };
}

/**
 * Enhanced parsing of Google batch response with robust individual URL tracking
 */
parseGoogleBatchResponse(responseText, originalUrls, boundary) {
  Logger.log(`🔍 Parsing Google batch response...`);
  
  const successfulUrls = [];
  const failedUrls = [];
  const urlStatusMap = new Map();
  
  try {
    // Initialize all URLs as unknown status
    originalUrls.forEach((url, index) => {
      urlStatusMap.set(index, { url: url, status: 'unknown', httpCode: null });
    });
    
    // Split response into parts using multiple boundary patterns
    let parts = [];
    
    // Try different boundary splitting approaches
    const boundaryPatterns = [
      new RegExp(`--${boundary}[^\r\n]*`, 'g'),
      /--batch_[^\r\n]*/g,
      /--[a-zA-Z0-9_]+/g
    ];
    
    for (const pattern of boundaryPatterns) {
      parts = responseText.split(pattern);
      if (parts.length > originalUrls.length) {
        Logger.log(`✅ Successfully split response using pattern: ${pattern}`);
        break;
      }
    }
    
    if (parts.length <= 1) {
      Logger.log(`⚠️ Could not split response properly, trying line-by-line parsing`);
      return this.fallbackResponseParsing(responseText, originalUrls);
    }
    
    Logger.log(`📦 Found ${parts.length} parts in response`);
    
    // Parse each part
    parts.forEach((part, partIndex) => {
      const trimmedPart = part.trim();
      if (!trimmedPart || trimmedPart.length < 10) return;
      
      // Extract Content-ID to map to original URL
      let urlIndex = -1;
      const contentIdPatterns = [
        /Content-ID:\s*<item(\d+)>/i,
        /Content-ID:\s*<response-item(\d+)>/i,
        /Content-ID:\s*item(\d+)/i
      ];
      
      for (const pattern of contentIdPatterns) {
        const match = trimmedPart.match(pattern);
        if (match) {
          urlIndex = parseInt(match[1], 10);
          break;
        }
      }
      
      if (urlIndex >= 0 && urlIndex < originalUrls.length) {
        const urlInfo = urlStatusMap.get(urlIndex);
        
        // Extract HTTP status code
        const httpStatusMatch = trimmedPart.match(/HTTP\/\d\.\d\s+(\d{3})/);
        let httpCode = null;
        if (httpStatusMatch) {
          httpCode = parseInt(httpStatusMatch[1], 10);
        }
        
        // Check for JSON response with error details
        let jsonStatus = null;
        const jsonMatch = trimmedPart.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            const jsonResponse = JSON.parse(jsonMatch[0]);
            if (jsonResponse.error) {
              jsonStatus = 'error';
              httpCode = jsonResponse.error.code || httpCode || 400;
              Logger.log(`📝 URL ${urlIndex} has error: ${jsonResponse.error.message || 'Unknown error'}`);
            } else if (jsonResponse.url || jsonResponse.urlNotificationMetadata) {
              jsonStatus = 'success';
              httpCode = httpCode || 200;
              Logger.log(`✅ URL ${urlIndex} processed successfully`);
            }
          } catch (jsonError) {
            Logger.log(`⚠️ Could not parse JSON for URL ${urlIndex}: ${jsonError.message}`);
          }
        }
        
        // Determine final status
        let finalStatus = 'unknown';
        if (httpCode === 200 || httpCode === 202 || jsonStatus === 'success') {
          finalStatus = 'success';
          successfulUrls.push(urlInfo.url);
        } else if (httpCode >= 400 || jsonStatus === 'error') {
          finalStatus = 'failed';
          failedUrls.push({ url: urlInfo.url, status: httpCode || 'unknown' });
        } else if (httpCode) {
          // Any other HTTP code
          finalStatus = httpCode >= 200 && httpCode < 300 ? 'success' : 'failed';
          if (finalStatus === 'success') {
            successfulUrls.push(urlInfo.url);
          } else {
            failedUrls.push({ url: urlInfo.url, status: httpCode });
          }
        }
        
        urlStatusMap.set(urlIndex, {
          url: urlInfo.url,
          status: finalStatus,
          httpCode: httpCode
        });
        
        Logger.log(`📊 URL ${urlIndex}: ${finalStatus} (HTTP: ${httpCode || 'N/A'})`);
      }
    });
    
    // Handle any URLs that couldn't be parsed (assume success if overall response was 200)
    const unparsedUrls = [];
    urlStatusMap.forEach((info, index) => {
      if (info.status === 'unknown') {
        unparsedUrls.push(info.url);
        successfulUrls.push(info.url); // Optimistic assumption for unparsed URLs
        Logger.log(`⚠️ URL ${index} status unknown, assuming success: ${info.url}`);
      }
    });
    
    Logger.log(`\n📊 GOOGLE BATCH RESULTS:`);
    Logger.log(`   ✅ Successful: ${successfulUrls.length}`);
    Logger.log(`   ❌ Failed: ${failedUrls.length}`);
    Logger.log(`   ❓ Unparsed (assumed success): ${unparsedUrls.length}`);
    
    return {
      success: true,
      submittedUrls: successfulUrls,
      failedUrls: failedUrls,
      rateLimited: false,
      unparsedUrls: unparsedUrls
    };
    
  } catch (parseError) {
    Logger.log(`⚠️ ERROR parsing Google response: ${parseError.message}`);
    Logger.log(`📄 Response preview: ${responseText.substring(0, 1000)}`);
    
    // Fallback: assume all succeeded if we got HTTP 200
    Logger.log(`🔄 Using fallback parsing - assuming all URLs succeeded`);
    return {
      success: true,
      submittedUrls: originalUrls,
      failedUrls: [],
      rateLimited: false,
      parseError: parseError.message
    };
  }
}

/**
 * Fallback response parsing when normal parsing fails
 */
fallbackResponseParsing(responseText, originalUrls) {
  Logger.log(`🔄 Using fallback response parsing method`);
  
  const successfulUrls = [];
  const failedUrls = [];
  
  // Look for error indicators in the response
  const hasErrors = responseText.includes('"error"') || 
                   responseText.includes('Error') || 
                   responseText.includes('failed');
  
  if (hasErrors) {
    Logger.log(`⚠️ Detected errors in response, will need manual review`);
    // Conservative approach: mark first half as failed for review
    const halfPoint = Math.ceil(originalUrls.length / 2);
    originalUrls.slice(0, halfPoint).forEach(url => {
      failedUrls.push({ url: url, status: 'parse_error' });
    });
    originalUrls.slice(halfPoint).forEach(url => {
      successfulUrls.push(url);
    });
  } else {
    // Optimistic approach: assume all succeeded
    originalUrls.forEach(url => successfulUrls.push(url));
    Logger.log(`✅ No obvious errors detected, assuming all URLs succeeded`);
  }
  
  return {
    success: true,
    submittedUrls: successfulUrls,
    failedUrls: failedUrls,
    rateLimited: false,
    fallbackUsed: true
  };
}

/**
* Gets OAuth2 token for Google Indexing API using built-in JWT authentication
*/
getServiceAccountToken() {
  Logger.log("🔑 Obtaining Google API access token...");
  
  try {
    // Validate credentials first
    if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
      Logger.log('❌ ERROR: Missing Google service account credentials');
      return null;
    }

    if (!SERVICE_ACCOUNT_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) {
      Logger.log('❌ ERROR: Invalid private key format');
      return null;
    }

    // Create JWT token
    const now = Math.floor(Date.now() / 1000);
    const expires = now + 3600; // 1 hour
    
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };
    
    const payload = {
      iss: SERVICE_ACCOUNT_EMAIL,
      scope: 'https://www.googleapis.com/auth/indexing',
      aud: 'https://oauth2.googleapis.com/token',
      exp: expires,
      iat: now
    };
    
    // Encode header and payload
    const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header));
    const encodedPayload = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
    
    // Create signature
    const signatureInput = encodedHeader + '.' + encodedPayload;
    const signature = Utilities.computeRsaSha256Signature(signatureInput, SERVICE_ACCOUNT_PRIVATE_KEY);
    const encodedSignature = Utilities.base64EncodeWebSafe(signature);
    
    // Create JWT
    const jwt = signatureInput + '.' + encodedSignature;
    
    // Exchange JWT for access token
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const tokenPayload = {
      'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'assertion': jwt
    };
    
    const options = {
      'method': 'post',
      'contentType': 'application/x-www-form-urlencoded',
      'payload': Object.keys(tokenPayload).map(key => 
        encodeURIComponent(key) + '=' + encodeURIComponent(tokenPayload[key])
      ).join('&'),
      'muteHttpExceptions': true
    };
    
    const response = UrlFetchApp.fetch(tokenUrl, options);
    const responseData = JSON.parse(response.getContentText());
    
    if (responseData.access_token) {
      Logger.log("✅ SUCCESS: Google API token obtained");
      return responseData.access_token;
    } else {
      Logger.log('❌ ERROR: Failed to obtain access token');
      Logger.log('Response: ' + response.getContentText());
      return null;
    }
    
  } catch (error) {
    Logger.log(`❌ ERROR obtaining Google token: ${error.message}`);
    Logger.log(`Stack trace: ${error.stack}`);
    return null;
  }
}

  /**
   * Check if Google API rate limit has been reached today
   */
  checkGoogleRateLimit() {
    const props = PropertiesService.getScriptProperties();
    const today = getShortDate();
    const lastSubmissionDate = props.getProperty("google_last_submission_date");
    const submissionsToday = parseInt(props.getProperty("google_submissions_today") || "0", 10);
    
    // Reset counter if it's a new day
    if (lastSubmissionDate !== today) {
      props.setProperties({
        "google_last_submission_date": today,
        "google_submissions_today": "0"
      });
      Logger.log(`🆕 New day detected, reset Google API counter`);
      return { limitReached: false, submissionsToday: 0 };
    }
    
    const limitReached = submissionsToday >= 200;
    Logger.log(`📊 Google API Usage Today: ${submissionsToday}/200 URLs`);
    
    if (limitReached) {
      Logger.log("⚠️ LIMIT REACHED: Google Indexing API daily limit (200 URLs) reached");
    }
    
    return { limitReached: limitReached, submissionsToday: submissionsToday };
  }

  /**
   * Update Google API usage counter with better error handling
   */
  updateGoogleUsageCounter(successfulUrls) {
    if (!successfulUrls || successfulUrls < 0) {
      Logger.log("⚠️ WARNING: Invalid URL count for Google usage counter");
      return;
    }

    try {
      const props = PropertiesService.getScriptProperties();
      const today = getShortDate();
      const currentCount = parseInt(props.getProperty("google_submissions_today") || "0", 10);
      const newCount = currentCount + successfulUrls;
      
      props.setProperties({
        "google_last_submission_date": today,
        "google_submissions_today": newCount.toString()
      });
      
      Logger.log(`📊 Updated Google API usage: ${newCount}/200 URLs today (+${successfulUrls})`);
      
      // Warning when approaching limit
      if (newCount >= 180) {
        Logger.log(`⚠️ WARNING: Approaching Google API daily limit (${newCount}/200)`);
      }
      
    } catch (error) {
      Logger.log(`❌ ERROR updating Google usage counter: ${error.message}`);
    }
  }

  /**
   * Test connection to a specific IndexNow endpoint
   */
  testIndexNowConnection(engine) {
    Logger.log(`🧪 Testing ${engine.toUpperCase()} connection...`);
    
    const endpoint = INDEXNOW_ENDPOINTS[engine];
    const apiKey = INDEXNOW_KEYS[engine];
    
    if (!endpoint || !apiKey) {
      Logger.log(`❌ Missing endpoint or API key for ${engine}`);
      return false;
    }
    
    try {
      // Test with empty URL list to check endpoint accessibility
      const payload = {
        "host": "test.example.com",
        "key": apiKey,
        "keyLocation": `https://test.example.com/${apiKey}.txt`,
        "urlList": []
      };
      
      const options = {
        "method": "POST",
        "contentType": "application/json; charset=utf-8",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
      };
      
      const response = UrlFetchApp.fetch(endpoint, options);
      const responseCode = response.getResponseCode();
      
      if (responseCode >= 200 && responseCode < 500) {
        Logger.log(`✅ ${engine.toUpperCase()}: Connection OK (HTTP ${responseCode})`);
        return true;
      } else {
        Logger.log(`⚠️ ${engine.toUpperCase()}: Unexpected response (HTTP ${responseCode})`);
        return false;
      }
      
    } catch (error) {
      Logger.log(`❌ ${engine.toUpperCase()}: Connection failed - ${error.message}`);
      return false;
    }
  }

  /**
   * Get detailed API status report
   */
  getApiStatusReport() {
    Logger.log("📊 === API STATUS REPORT ===");
    
    // Test Google API
    Logger.log("\n🇺🇸 Google Indexing API:");
    const token = this.getServiceAccountToken();
    if (token) {
      Logger.log("✅ Authentication: OK");
      
      const rateStatus = this.checkGoogleRateLimit();
      Logger.log(`📊 Daily usage: ${rateStatus.submissionsToday}/200 URLs`);
      Logger.log(`🚦 Rate limit: ${rateStatus.limitReached ? 'REACHED' : 'OK'}`);
    } else {
      Logger.log("❌ Authentication: FAILED");
    }
    
    // Test IndexNow APIs
    Logger.log("\n🔥 IndexNow APIs:");
    const engines = Object.keys(INDEXNOW_ENDPOINTS);
    let workingEngines = 0;
    
    engines.forEach(engine => {
      if (this.testIndexNowConnection(engine)) {
        workingEngines++;
      }
    });
    
    Logger.log(`📊 Working engines: ${workingEngines}/${engines.length}`);
    
    return {
      google: {
        authenticated: !!token,
        rateStatus: token ? this.checkGoogleRateLimit() : null
      },
      indexnow: {
        totalEngines: engines.length,
        workingEngines: workingEngines
      }
    };
  }
}