/**
 * @fileoverview Enhanced utility and helper functions with better error handling, scheduling, and monitoring capabilities.
 */

const MAX_EXECUTION_TIME = 300 * 1000; // 5 minutes (300 seconds)
let startTime = new Date().getTime();

/**
 * Checks if the script is approaching its execution time limit.
 * @return {boolean} True if time is almost up, false otherwise.
 */
function isTimeUp() {
  const elapsed = new Date().getTime() - startTime;
  const remaining = MAX_EXECUTION_TIME - elapsed;
  
  // Log time status every 60 seconds
  if (Math.floor(elapsed / 60000) > Math.floor((elapsed - 5000) / 60000)) {
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    Logger.log(`Runtime: ${minutes}m ${seconds}s, Remaining: ${Math.max(0, Math.floor(remaining / 1000))}s`);
  }
  
  return remaining < 30000; // 30-second buffer
}

/**
 * Reset the execution timer (call at the start of main functions)
 */
function resetTimer() {
  startTime = new Date().getTime();
  Logger.log(`Execution timer started at ${new Date().toLocaleTimeString()}`);
}

/**
 * Enhanced function to determine if a URL should be resubmitted based on its last submission status.
 * @param {string} status The last submission date or status string.
 * @return {boolean} True if the URL needs to be re-indexed, false otherwise.
 */
function shouldResubmit(status) {
  // Handle null, undefined, or empty values
  if (!status || status === "Pending" || status === "" || status === null || status === undefined) {
    return true;
  }
  
  // Convert to string and trim
  const statusStr = String(status).trim();
  if (statusStr === "" || statusStr === "Pending") {
    return true;
  }
  
  // Check for date pattern (YYYY-MM-DD)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (datePattern.test(statusStr)) {
    try {
      const [year, month, day] = statusStr.split("-").map(Number);
      
      // Validate date components
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        Logger.log(`Invalid date format: ${statusStr}, treating as pending`);
        return true;
      }

      const lastSubmissionDate = new Date(year, month - 1, day);
      const currentDate = new Date();

      // Check if date is in the future (shouldn't happen, but handle gracefully)
      if (lastSubmissionDate > currentDate) {
        Logger.log(`Future date detected: ${statusStr}, treating as completed`);
        return false;
      }

      // Reject unreasonably old dates
      if (year < 2020) {
        Logger.log(`Very old date: ${statusStr}, treating as pending`);
        return true;
      }
      
      const differenceInTime = currentDate - lastSubmissionDate;
      const differenceInDays = differenceInTime / (1000 * 3600 * 24);
      
      return differenceInDays > SUBMISSION_INTERVAL_DAYS;
      
    } catch (error) {
      Logger.log(`Error parsing date ${statusStr}: ${error.message}, treating as pending`);
      return true;
    }
  }
  
  // For any other status string, assume it needs resubmission
  return true;
}

/**
 * Verify that URL collection preserves existing indexing status
 */
function verifyUrlStatusPreservation() {
  Logger.log("=== URL STATUS PRESERVATION VERIFICATION ===");
  
  try {
    const spreadsheetManager = new SpreadsheetManagerV2();
    const folder = spreadsheetManager.getIndexingFolder();
    const files = folder.getFiles();
    
    let verifiedSheets = 0;
    let issuesFound = 0;
    
    while (files.hasNext()) {
      const file = files.next();
      
      if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
        const spreadsheet = SpreadsheetApp.openById(file.getId());
        const sheet = spreadsheet.getActiveSheet();
        const lastRow = sheet.getLastRow();
        
        if (lastRow > 1) {
          verifiedSheets++;
          
          // Get all data
          const data = sheet.getRange(1, 1, lastRow, HEADER_ROW.length).getValues();
          
          // Check for any issues
          const urlColumn = 7; // URL is column 8 (index 7)
          const statusColumns = [0, 1, 2, 3, 4, 5]; // Status columns
          
          const urlCounts = new Map();
          let duplicateUrls = 0;
          let invalidStatuses = 0;
          
          for (let i = 1; i < data.length; i++) { // Skip header row
            const url = data[i][urlColumn];
            
            if (url) {
              // Check for duplicate URLs
              if (urlCounts.has(url)) {
                urlCounts.set(url, urlCounts.get(url) + 1);
                duplicateUrls++;
              } else {
                urlCounts.set(url, 1);
              }
              
              // Check status consistency
              const statuses = statusColumns.map(col => data[i][col]);
              const hasValidStatus = statuses.every(status => 
                status === "Pending" || 
                /^\d{4}-\d{2}-\d{2}$/.test(status) ||
                status === "" ||
                status === null
              );
              
              if (!hasValidStatus) {
                invalidStatuses++;
                Logger.log(`Invalid status in ${spreadsheet.getName()}, row ${i + 1}: ${statuses.join(', ')}`);
              }
            }
          }
          
          if (duplicateUrls > 0) {
            issuesFound++;
            Logger.log(`❌ ${spreadsheet.getName()}: ${duplicateUrls} duplicate URLs found`);
          }
          
          if (invalidStatuses > 0) {
            issuesFound++;
            Logger.log(`❌ ${spreadsheet.getName()}: ${invalidStatuses} invalid status entries`);
          }
          
          if (duplicateUrls === 0 && invalidStatuses === 0) {
            Logger.log(`✅ ${spreadsheet.getName()}: Status preservation verified`);
          }
        }
      }
    }
    
    Logger.log(`\n=== VERIFICATION COMPLETE ===`);
    Logger.log(`Verified: ${verifiedSheets} spreadsheets`);
    Logger.log(`Issues found: ${issuesFound} spreadsheets with problems`);
    
    if (issuesFound === 0) {
      Logger.log(`✅ All spreadsheets have proper URL and status handling`);
    } else {
      Logger.log(`⚠️ Some spreadsheets have issues that need attention`);
    }
    
    return {
      success: issuesFound === 0,
      verifiedSheets: verifiedSheets,
      issuesFound: issuesFound
    };
    
  } catch (error) {
    Logger.log(`❌ Verification failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Test URL preservation with a specific spreadsheet
 */
function testUrlPreservation(spreadsheetName = null) {
  Logger.log("=== TESTING URL PRESERVATION ===");
  
  try {
    const spreadsheetManager = new SpreadsheetManagerV2();
    let testSpreadsheet;
    
    if (spreadsheetName) {
      // Find specific spreadsheet
      const folder = spreadsheetManager.getIndexingFolder();
      const files = folder.getFilesByName(spreadsheetName);
      if (files.hasNext()) {
        testSpreadsheet = SpreadsheetApp.openById(files.next().getId());
      } else {
        Logger.log(`Spreadsheet not found: ${spreadsheetName}`);
        return { success: false, error: "Spreadsheet not found" };
      }
    } else {
      // Use first available spreadsheet
      const allSheets = spreadsheetManager.getAllIndexingSpreadsheets();
      if (allSheets.length === 0) {
        Logger.log("No spreadsheets found to test");
        return { success: false, error: "No spreadsheets available" };
      }
      testSpreadsheet = allSheets[0];
    }
    
    const sheet = testSpreadsheet.getActiveSheet();
    const name = testSpreadsheet.getName();
    
    Logger.log(`Testing with: ${name}`);
    
    // Get current state
    const beforeRows = sheet.getLastRow();
    const beforeData = beforeRows > 1 ? 
      sheet.getRange(1, 1, beforeRows, HEADER_ROW.length).getValues() : [];
    
    Logger.log(`Before: ${beforeRows - 1} URLs`);
    
    // Create test URLs (some new, some existing)
    const testUrls = [];
    
    if (beforeData.length > 1) {
      // Add some existing URLs
      testUrls.push(beforeData[1][7]); // First URL
      if (beforeData.length > 2) {
        testUrls.push(beforeData[2][7]); // Second URL
      }
    }
    
    // Add some new URLs
    testUrls.push("https://test.example.com/new-url-1");
    testUrls.push("https://test.example.com/new-url-2");
    
    Logger.log(`Test URLs: ${testUrls.length} (${testUrls.filter(url => 
      beforeData.some(row => row[7] === url)
    ).length} existing, ${testUrls.filter(url => 
      !beforeData.some(row => row[7] === url)
    ).length} new)`);
    
    // Apply the URL addition logic (simulate sitemap collection)
    const collector = new SitemapCollectorV2();
    const result = collector.addUrlsToSpreadsheet(testSpreadsheet, testUrls);
    
    // Check results
    const afterRows = sheet.getLastRow();
    const afterData = sheet.getRange(1, 1, afterRows, HEADER_ROW.length).getValues();
    
    Logger.log(`After: ${afterRows - 1} URLs`);
    Logger.log(`Added: ${result.newUrls} new URLs`);
    Logger.log(`Duplicates skipped: ${result.duplicates}`);
    
    // Verify existing URLs weren't modified
    let preservationVerified = true;
    for (let i = 1; i < Math.min(beforeData.length, afterData.length); i++) {
      for (let j = 0; j < HEADER_ROW.length; j++) {
        if (beforeData[i][j] !== afterData[i][j]) {
          Logger.log(`❌ Row ${i + 1}, Column ${j + 1} changed: "${beforeData[i][j]}" → "${afterData[i][j]}"`);
          preservationVerified = false;
        }
      }
    }
    
    if (preservationVerified) {
      Logger.log(`✅ All existing URL statuses preserved correctly`);
    }
    
    return {
      success: preservationVerified && result.newUrls >= 0,
      beforeRows: beforeRows - 1,
      afterRows: afterRows - 1,
      newUrls: result.newUrls,
      duplicates: result.duplicates,
      preservationVerified: preservationVerified
    };
    
  } catch (error) {
    Logger.log(`❌ Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Fix existing spreadsheets with Date object issues
 * Run this once to clean up existing data
 */
function fixExistingDateObjects() {
  Logger.log("=== FIXING EXISTING DATE OBJECTS ===");
  
  try {
    const spreadsheetManager = new SpreadsheetManagerV2();
    const folder = spreadsheetManager.getIndexingFolder();
    const files = folder.getFiles();
    
    let fixedSheets = 0;
    let fixedCells = 0;
    
    while (files.hasNext()) {
      const file = files.next();
      
      if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
        const spreadsheet = SpreadsheetApp.openById(file.getId());
        const sheet = spreadsheet.getActiveSheet();
        const lastRow = sheet.getLastRow();
        
        if (lastRow > 1) {
          const dataRange = sheet.getRange(1, 1, lastRow, HEADER_ROW.length);
          const values = dataRange.getValues();
          let sheetFixed = false;
          
          // Fix Date objects in status columns (0-5)
          for (let i = 1; i < values.length; i++) {
            for (let j = 0; j < 6; j++) {
              const cellValue = values[i][j];
              if (cellValue instanceof Date) {
                values[i][j] = getShortDateFromDate(cellValue);
                fixedCells++;
                sheetFixed = true;
              }
            }
          }
          
          if (sheetFixed) {
            dataRange.setValues(values);
            fixedSheets++;
            Logger.log(`✅ Fixed ${spreadsheet.getName()}`);
          }
        }
      }
    }
    
    Logger.log(`=== FIX COMPLETE ===`);
    Logger.log(`Fixed: ${fixedSheets} spreadsheets`);
    Logger.log(`Fixed: ${fixedCells} date objects`);
    
    return { success: true, fixedSheets, fixedCells };
    
  } catch (error) {
    Logger.log(`❌ Fix failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Enhanced function to check if a URL contains a non-English language code in its path.
 * @param {string} url The URL to check.
 * @return {boolean} True if a non-English language code is found, false otherwise.
 */
function hasLangCode(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  try {
    const path = url.replace(/^https?:\/\/[^\/]+/, '');
    const segments = path.split('/').filter(segment => segment.length > 0);
    
    // Define comprehensive language code list (excluding 'en')
    const nonEnglishLangCodes = [
      'de', 'es', 'fr', 'ja', 'ko', 'ru', 'zh', 'ar', 'it', 'pt', 'pl', 
      'fa', 'id', 'cs', 'vi', 'tr', 'th', 'sv', 'el', 'uk', 'bg', 'sr',
      'da', 'fi', 'he', 'hi', 'hu', 'lv', 'ms', 'nl', 'no', 'lt', 'ca', 
      'hr', 'ro', 'sk'
    ];
    
    for (const segment of segments) {
      // Check for exact language code match (case insensitive)
      if (nonEnglishLangCodes.includes(segment.toLowerCase())) {
        return true;
      }
    }
    
  } catch (e) {
    Logger.log(`Error parsing URL for lang code: ${e.message} - URL: ${url}`);
  }
  
  return false;
}

/**
 * Enhanced getShortDate function to ensure string output
 * Add this to utilities.gs or replace existing getShortDate
 */
function getShortDate() {
  try {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;
    
    // Verify it's a string
    if (typeof dateString !== 'string') {
      Logger.log(`ERROR: getShortDate produced ${typeof dateString}: ${dateString}`);
      return '2024-01-01'; // Fallback
    }
    
    return dateString;
  } catch (error) {
    Logger.log(`Error formatting date: ${error.message}`);
    return '2024-01-01'; // Fallback date
  }
}

/**
 * Helper function to convert Date objects to YYYY-MM-DD strings
 * Add this to utilities.gs
 */
function getShortDateFromDate(dateObj) {
  try {
    if (!(dateObj instanceof Date)) {
      return String(dateObj); // Return as-is if not a Date
    }
    
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    Logger.log(`Error converting date object: ${error.message}`);
    return getShortDate(); // Fallback to current date
  }
}


/**
 * Enhanced daily trigger setup with better error handling and validation
 */
function setupDailyTriggers() {
  Logger.log("Setting up daily triggers");
  
  try {
    // Clean up existing triggers first
    cleanupAllTriggers();
    
    // Validate that functions exist before creating triggers
    const requiredFunctions = ['collectAllURLs', 'indexIndexNow', 'indexGoogle'];
    for (const funcName of requiredFunctions) {
      if (typeof eval(funcName) !== 'function') {
        throw new Error(`Required function ${funcName} is not defined`);
      }
    }
    
    const triggerResults = [];
    
    // Create trigger for sitemap collection (runs every day at 1 AM)
    try {
      const sitemapTrigger = ScriptApp.newTrigger('collectAllURLs')
        .timeBased()
        .everyDays(1)
        .atHour(1)
        .create();
      
      triggerResults.push({ 
        function: 'collectAllURLs', 
        id: sitemapTrigger.getUniqueId(), 
        time: '1:00 AM',
        success: true 
      });
    } catch (error) {
      Logger.log(`Failed to create sitemap trigger: ${error.message}`);
      triggerResults.push({ function: 'collectAllURLs', success: false, error: error.message });
    }
    
    // Create trigger for IndexNow (runs every day at 2 AM)
    try {
      const indexNowTrigger = ScriptApp.newTrigger('indexIndexNow')
        .timeBased()
        .everyDays(1)
        .atHour(2)
        .create();
      
      triggerResults.push({ 
        function: 'indexIndexNow', 
        id: indexNowTrigger.getUniqueId(), 
        time: '2:00 AM',
        success: true 
      });
    } catch (error) {
      Logger.log(`Failed to create IndexNow trigger: ${error.message}`);
      triggerResults.push({ function: 'indexIndexNow', success: false, error: error.message });
    }
    
    // Create trigger for Google Indexing (runs every day at 3 AM)
    try {
      const googleTrigger = ScriptApp.newTrigger('indexGoogle')
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .create();
      
      triggerResults.push({ 
        function: 'indexGoogle', 
        id: googleTrigger.getUniqueId(), 
        time: '3:00 AM',
        success: true 
      });
    } catch (error) {
      Logger.log(`Failed to create Google trigger: ${error.message}`);
      triggerResults.push({ function: 'indexGoogle', success: false, error: error.message });
    }
    
    // Report results
    const successfulTriggers = triggerResults.filter(r => r.success);
    Logger.log(`Successfully created ${successfulTriggers.length}/${triggerResults.length} triggers`);
    
    if (successfulTriggers.length > 0) {
      Logger.log("DAILY SCHEDULE:");
      successfulTriggers.forEach(trigger => {
        Logger.log(`   ${trigger.time} - ${trigger.function}`);
      });
    }
    
    const failedTriggers = triggerResults.filter(r => !r.success);
    if (failedTriggers.length > 0) {
      Logger.log("FAILED TRIGGERS:");
      failedTriggers.forEach(trigger => {
        Logger.log(`   ${trigger.function}: ${trigger.error}`);
      });
    }
    
    return successfulTriggers.length === triggerResults.length;
    
  } catch (error) {
    Logger.log(`Critical error setting up triggers: ${error.message}`);
    return false;
  }
}

/**
 * Enhanced trigger cleanup with better logging and error handling
 */
function cleanupAllTriggers() {
  Logger.log("Cleaning up all triggers");
  
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let deletedCount = 0;
    let errorCount = 0;
    
    if (triggers.length === 0) {
      Logger.log("No triggers found to clean up");
      return true;
    }
    
    Logger.log(`Found ${triggers.length} triggers to clean up`);
    
    triggers.forEach((trigger, index) => {
      try {
        const functionName = trigger.getHandlerFunction();
        const triggerType = trigger.getTriggerSource();
        const triggerId = trigger.getUniqueId();
        
        ScriptApp.deleteTrigger(trigger);
        deletedCount++;
        Logger.log(`Deleted trigger ${index + 1}: ${functionName} (${triggerType}) - ID: ${triggerId}`);
        
      } catch (error) {
        errorCount++;
        Logger.log(`Error deleting trigger ${index + 1}: ${error.message}`);
      }
    });
    
    Logger.log(`Cleanup completed: ${deletedCount} deleted, ${errorCount} errors`);
    return errorCount === 0;
    
  } catch (error) {
    Logger.log(`Critical error during trigger cleanup: ${error.message}`);
    return false;
  }
}

/**
 * Enhanced trigger status report with detailed information
 */
function getTriggerReport() {
  Logger.log("=== TRIGGER STATUS REPORT ===");
  
  try {
    const triggers = ScriptApp.getProjectTriggers();
    
    if (triggers.length === 0) {
      Logger.log("No triggers found - automatic scheduling is disabled");
      Logger.log("Run setupDailyTriggers() to enable automatic scheduling");
      return { totalTriggers: 0, activeTriggers: [], issues: [] };
    }
    
    Logger.log(`Found ${triggers.length} active triggers:`);
    
    const activeTriggers = [];
    const issues = [];
    
    triggers.forEach((trigger, index) => {
      try {
        const functionName = trigger.getHandlerFunction();
        const triggerSource = trigger.getTriggerSource();
        const triggerType = trigger.getEventType();
        const triggerId = trigger.getUniqueId();
        
        const triggerInfo = {
          index: index + 1,
          function: functionName,
          source: triggerSource,
          type: triggerType,
          id: triggerId
        };
        
        Logger.log(`   ${index + 1}. Function: ${functionName}`);
        Logger.log(`      Source: ${triggerSource}`);
        Logger.log(`      Type: ${triggerType}`);
        Logger.log(`      ID: ${triggerId}`);
        
        // Check if it's a time-based trigger and get next run time
        if (triggerSource === ScriptApp.TriggerSource.CLOCK) {
          try {
            const nextRun = new Date(trigger.getTriggerSourceId());
            Logger.log(`      Next run: ${nextRun.toLocaleString()}`);
            triggerInfo.nextRun = nextRun;
          } catch (timeError) {
            Logger.log(`      Next run: Unable to determine`);
            issues.push(`Cannot determine next run time for ${functionName}`);
          }
        }
        
        activeTriggers.push(triggerInfo);
        
      } catch (error) {
        issues.push(`Error reading trigger ${index + 1}: ${error.message}`);
        Logger.log(`   Error reading trigger ${index + 1}: ${error.message}`);
      }
    });
    
    if (issues.length > 0) {
      Logger.log("\nISSUES FOUND:");
      issues.forEach(issue => Logger.log(`   - ${issue}`));
    }
    
    return {
      totalTriggers: triggers.length,
      activeTriggers: activeTriggers,
      issues: issues
    };
    
  } catch (error) {
    Logger.log(`Critical error generating trigger report: ${error.message}`);
    return { totalTriggers: 0, activeTriggers: [], issues: [error.message] };
  }
}

/**
 * Enhanced emergency stop with better cleanup and confirmation
 */
function emergencyStop() {
  Logger.log("EMERGENCY STOP ACTIVATED");
  
  try {
    // Get current state before cleanup
    const triggers = ScriptApp.getProjectTriggers();
    const props = PropertiesService.getScriptProperties();
    const allProperties = props.getProperties();
    
    Logger.log(`Current state: ${triggers.length} triggers, ${Object.keys(allProperties).length} properties`);
    
    // Clean up all triggers
    const cleanupSuccess = cleanupAllTriggers();
    
    // Clear all progress with backup
    const backupKey = `emergency_backup_${Date.now()}`;
    props.setProperty(backupKey, JSON.stringify({
      timestamp: new Date().toISOString(),
      properties: allProperties
    }));
    
    Logger.log(`Created backup with key: ${backupKey}`);
    
    // Clear current properties
    props.deleteAllProperties();
    
    // Restore backup key for recovery
    props.setProperty(backupKey, JSON.stringify({
      timestamp: new Date().toISOString(),
      properties: allProperties
    }));
    
    Logger.log("All triggers disabled and progress cleared");
    Logger.log("Emergency backup created for potential recovery");
    Logger.log("To resume: run the appropriate setup functions");
    
    return {
      success: cleanupSuccess,
      backupKey: backupKey,
      triggersCleared: triggers.length,
      propertiesCleared: Object.keys(allProperties).length
    };
    
  } catch (error) {
    Logger.log(`Critical error during emergency stop: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Enhanced safe restart with better progress preservation
 */
function safeRestart() {
  Logger.log("SAFE RESTART INITIATED");
  
  try {
    const props = PropertiesService.getScriptProperties();
    
    // Preserve critical progress
    const criticalKeys = [
      "sitemapQueue",
      "processedSitemaps", 
      "currentSitemapIndex",
      "google_last_submission_date",
      "google_submissions_today"
    ];
    
    const preservedData = {};
    criticalKeys.forEach(key => {
      const value = props.getProperty(key);
      if (value) {
        preservedData[key] = value;
      }
    });
    
    Logger.log(`Preserving ${Object.keys(preservedData).length} critical properties`);
    
    // Clear operation-specific progress
    const clearKeys = [
      "indexNow_processedSheets",
      "google_processedSheets", 
      "google_current_language",
      "google_language_index"
    ];
    
    clearKeys.forEach(key => {
      props.deleteProperty(key);
    });
    
    Logger.log(`Cleared ${clearKeys.length} operation-specific properties`);
    Logger.log("Critical sitemap progress preserved");
    Logger.log("Next runs will restart indexing from the beginning");
    
    return {
      success: true,
      preservedKeys: Object.keys(preservedData).length,
      clearedKeys: clearKeys.length
    };
    
  } catch (error) {
    Logger.log(`Error during safe restart: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Enhanced health check with comprehensive system validation
 */
function healthCheck() {
  Logger.log("=== COMPREHENSIVE HEALTH CHECK ===");
  
  const healthReport = {
    overall: 'UNKNOWN',
    errors: [],
    warnings: [],
    components: {}
  };
  
  try {
    // Check Google API credentials
    Logger.log("\nTesting Google API...");
    try {
      const Indexing = new IndexingAPI();
      const token = Indexing.getServiceAccountToken();
      if (token) {
        Logger.log("Google API credentials: OK");
        healthReport.components.googleApi = { status: 'OK', token: true };
      } else {
        healthReport.errors.push("Google API credentials failed");
        healthReport.components.googleApi = { status: 'ERROR', token: false };
      }
    } catch (error) {
      healthReport.errors.push(`Google API error: ${error.message}`);
      healthReport.components.googleApi = { status: 'ERROR', error: error.message };
    }
    
    // Check IndexNow API keys
    Logger.log("\nValidating IndexNow API keys...");
    let validKeys = 0;
    const totalKeys = Object.keys(INDEXNOW_KEYS).length;
    
    Object.entries(INDEXNOW_KEYS).forEach(([engine, key]) => {
      if (key && key.length > 10) {
        validKeys++;
      } else {
        healthReport.warnings.push(`${engine} API key appears invalid`);
      }
    });
    
    Logger.log(`IndexNow API keys: ${validKeys}/${totalKeys} valid`);
    healthReport.components.indexnowKeys = { 
      status: validKeys === totalKeys ? 'OK' : 'WARNING',
      validKeys: validKeys,
      totalKeys: totalKeys
    };
    
    // Check indexing folder and spreadsheets
    Logger.log("\nChecking storage system...");
    try {
      const spreadsheetMgr = new SpreadsheetManagerV2();
      const folder = spreadsheetMgr.getIndexingFolder();
      const stats = spreadsheetMgr.getProcessingStatistics();
      const spreadsheets = { length: stats.totalSpreadsheets };
      
      Logger.log(`Indexing folder: ${spreadsheets.length} spreadsheets found`);
      healthReport.components.storage = { 
        status: 'OK', 
        spreadsheets: spreadsheets.length,
        folderName: folder.getName()
      };
      
      if (spreadsheets.length === 0) {
        healthReport.warnings.push("No indexing spreadsheets found - may need to run sitemap collection");
      }
      
    } catch (error) {
      healthReport.errors.push(`Storage system error: ${error.message}`);
      healthReport.components.storage = { status: 'ERROR', error: error.message };
    }
    
    // Check triggers
    Logger.log("\nValidating triggers...");
    const triggerReport = getTriggerReport();
    const expectedTriggers = ['collectAllURLs', 'indexIndexNow', 'indexGoogle'];
    const activeFunctions = triggerReport.activeTriggers.map(t => t.function);
    
    const missingTriggers = expectedTriggers.filter(expected => 
      !activeFunctions.includes(expected)
    );
    
    if (missingTriggers.length === 0) {
      Logger.log("All expected triggers found");
      healthReport.components.triggers = { 
        status: 'OK', 
        total: triggerReport.totalTriggers,
        expected: expectedTriggers.length
      };
    } else {
      missingTriggers.forEach(missing => {
        healthReport.warnings.push(`Trigger for ${missing} not found`);
      });
      healthReport.components.triggers = { 
        status: 'WARNING', 
        total: triggerReport.totalTriggers,
        missing: missingTriggers
      };
    }
    
    // Check rate limits and quotas
    Logger.log("\nChecking API quotas...");
    const props = PropertiesService.getScriptProperties();
    const googleSubmissions = parseInt(props.getProperty("google_submissions_today") || "0", 10);
    const lastSubmissionDate = props.getProperty("google_last_submission_date");
    const today = getShortDate();
    
    if (lastSubmissionDate === today && googleSubmissions >= 200) {
      healthReport.warnings.push("Google API daily limit reached");
      healthReport.components.quotas = { status: 'WARNING', googleUsage: googleSubmissions };
    } else {
      Logger.log(`Google API usage: ${googleSubmissions}/200 today`);
      healthReport.components.quotas = { status: 'OK', googleUsage: googleSubmissions };
    }
    
    // Check configuration
    Logger.log("\nValidating configuration...");
    const configIssues = [];
    
    if (!HEADER_ROW || HEADER_ROW.length === 0) {
      configIssues.push("HEADER_ROW not properly configured");
    }
    if (!SUBMISSION_INTERVAL_DAYS || SUBMISSION_INTERVAL_DAYS < 1) {
      configIssues.push("SUBMISSION_INTERVAL_DAYS invalid");
    }
    if (!INDEXNOW_ENDPOINTS || Object.keys(INDEXNOW_ENDPOINTS).length === 0) {
      configIssues.push("INDEXNOW_ENDPOINTS not configured");
    }
    
    if (configIssues.length > 0) {
      configIssues.forEach(issue => healthReport.errors.push(`Configuration: ${issue}`));
      healthReport.components.configuration = { status: 'ERROR', issues: configIssues };
    } else {
      healthReport.components.configuration = { status: 'OK' };
    }
    
    // Determine overall health
    if (healthReport.errors.length === 0) {
      healthReport.overall = healthReport.warnings.length === 0 ? 'HEALTHY' : 'WARNING';
    } else {
      healthReport.overall = 'ERROR';
    }
    
    // Summary
    Logger.log(`\nHEALTH CHECK SUMMARY:`);
    Logger.log(`   Overall Status: ${healthReport.overall}`);
    Logger.log(`   Errors: ${healthReport.errors.length}`);
    Logger.log(`   Warnings: ${healthReport.warnings.length}`);
    
    if (healthReport.errors.length > 0) {
      Logger.log(`ERRORS:`);
      healthReport.errors.forEach(error => Logger.log(`   - ${error}`));
    }
    
    if (healthReport.warnings.length > 0) {
      Logger.log(`WARNINGS:`);
      healthReport.warnings.forEach(warning => Logger.log(`   - ${warning}`));
    }
    
    if (healthReport.overall === 'HEALTHY') {
      Logger.log(`All systems healthy!`);
    }
    
    return healthReport;
    
  } catch (error) {
    Logger.log(`Critical error during health check: ${error.message}`);
    healthReport.overall = 'CRITICAL_ERROR';
    healthReport.errors.push(`Health check failed: ${error.message}`);
    return healthReport;
  }
}

/**
 * Enhanced performance monitoring with better metrics collection
 */
function logPerformanceMetrics(functionName, startTime, successCount, totalCount, additionalData = {}) {
  try {
    const endTime = new Date().getTime();
    const duration = (endTime - startTime) / 1000;
    const successRate = totalCount > 0 ? (successCount / totalCount * 100) : 0;
    const avgTimePerItem = totalCount > 0 ? (duration / totalCount) : 0;
    
    Logger.log(`PERFORMANCE METRICS [${functionName}]:`);
    Logger.log(`   Duration: ${duration.toFixed(2)}s`);
    Logger.log(`   Success rate: ${successRate.toFixed(1)}% (${successCount}/${totalCount})`);
    Logger.log(`   Average time per item: ${avgTimePerItem.toFixed(3)}s`);
    
    if (additionalData && Object.keys(additionalData).length > 0) {
      Logger.log(`   Additional metrics:`);
      Object.entries(additionalData).forEach(([key, value]) => {
        Logger.log(`     ${key}: ${value}`);
      });
    }
    
    // Store metrics for trend analysis with enhanced data
    const props = PropertiesService.getScriptProperties();
    const metricsKey = `metrics_${functionName}_${getShortDate()}`;
    const metrics = {
      date: getShortDate(),
      timestamp: new Date().toISOString(),
      duration: parseFloat(duration.toFixed(2)),
      successCount: successCount,
      totalCount: totalCount,
      successRate: parseFloat(successRate.toFixed(1)),
      avgTimePerItem: parseFloat(avgTimePerItem.toFixed(3)),
      ...additionalData
    };
    
    props.setProperty(metricsKey, JSON.stringify(metrics));
    Logger.log(`Performance metrics saved with key: ${metricsKey}`);
    
  } catch (error) {
    Logger.log(`Error logging performance metrics: ${error.message}`);
  }
}

/**
 * Enhanced performance trends analysis
 */
function getPerformanceTrends(days = 7) {
  Logger.log(`=== PERFORMANCE TRENDS (Last ${days} Days) ===`);
  
  try {
    const props = PropertiesService.getScriptProperties();
    const functions = ['collectAllURLs', 'indexIndexNow', 'indexGoogle'];
    
    functions.forEach(functionName => {
      Logger.log(`\n${functionName}:`);
      
      const metrics = [];
      
      // Get data for specified number of days
      for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = getShortDateFromDate(date);
        
        const metricsKey = `metrics_${functionName}_${dateStr}`;
        const dayMetrics = props.getProperty(metricsKey);
        
        if (dayMetrics) {
          try {
            const parsed = JSON.parse(dayMetrics);
            metrics.push(parsed);
            Logger.log(`   ${dateStr}: ${parsed.duration}s, ${parsed.successRate}% success, ${parsed.totalCount} items`);
          } catch (parseError) {
            Logger.log(`   ${dateStr}: Error parsing metrics`);
          }
        }
      }
      
      if (metrics.length === 0) {
        Logger.log(`   No performance data available`);
      } else {
        // Calculate trends
        const avgDuration = metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length;
        const avgSuccess = metrics.reduce((sum, m) => sum + m.successRate, 0) / metrics.length;
        const totalItems = metrics.reduce((sum, m) => sum + m.totalCount, 0);
        
        Logger.log(`   ${days}-day averages: ${avgDuration.toFixed(1)}s duration, ${avgSuccess.toFixed(1)}% success`);
        Logger.log(`   Total items processed: ${totalItems}`);
        
        // Identify trends
        if (metrics.length > 1) {
          const recentAvg = metrics.slice(0, Math.ceil(metrics.length / 2))
                                  .reduce((sum, m) => sum + m.successRate, 0) / Math.ceil(metrics.length / 2);
          const olderAvg = metrics.slice(Math.ceil(metrics.length / 2))
                                 .reduce((sum, m) => sum + m.successRate, 0) / Math.floor(metrics.length / 2);
          
          const trend = recentAvg - olderAvg;
          if (Math.abs(trend) > 5) {
            Logger.log(`   Trend: ${trend > 0 ? 'Improving' : 'Declining'} (${trend.toFixed(1)}% change)`);
          }
        }
      }
    });
    
    return { success: true, days: days, functions: functions };
    
  } catch (error) {
    Logger.log(`Error generating performance trends: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// getShortDateFromDate() is defined earlier in this file (line ~431) — single definition to avoid override

/**
 * Enhanced cleanup of old performance metrics with better filtering
 */
function cleanupOldMetrics(keepDays = 30) {
  Logger.log(`Cleaning up performance metrics older than ${keepDays} days...`);
  
  try {
    const props = PropertiesService.getScriptProperties();
    const allProperties = props.getProperties();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - keepDays);
    
    let deletedCount = 0;
    let checkedCount = 0;
    
    Object.keys(allProperties).forEach(key => {
      if (key.startsWith('metrics_')) {
        checkedCount++;
        
        // Extract date from key (format: metrics_functionName_YYYY-MM-DD)
        const parts = key.split('_');
        if (parts.length >= 3) {
          const datePart = parts[parts.length - 1];
          
          if (datePart && datePart.match(/^\d{4}-\d{2}-\d{2}$/)) {
            try {
              const metricDate = new Date(datePart);
              if (metricDate < cutoffDate) {
                props.deleteProperty(key);
                deletedCount++;
              }
            } catch (dateError) {
              Logger.log(`Invalid date format in key: ${key}, deleting anyway`);
              props.deleteProperty(key);
              deletedCount++;
            }
          }
        }
      }
    });
    
    Logger.log(`Cleaned up ${deletedCount}/${checkedCount} old metric entries`);
    return { success: true, deletedCount: deletedCount, checkedCount: checkedCount };
    
  } catch (error) {
    Logger.log(`Error cleaning up old metrics: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Enhanced system status logger with comprehensive information
 */
function logSystemStatus() {
  Logger.log("=== CURRENT SYSTEM STATUS ===");
  
  try {
    const props = PropertiesService.getScriptProperties();
    
    // Sitemap collection progress
    const sitemapQueue = JSON.parse(props.getProperty("sitemapQueue") || "[]");
    const processedSitemaps = JSON.parse(props.getProperty("processedSitemaps") || "[]");
    const currentSitemapIndex = parseInt(props.getProperty("currentSitemapIndex") || "0", 10);
    
    Logger.log(`Sitemap Collection:`);
    Logger.log(`   Queue size: ${sitemapQueue.length}`);
    Logger.log(`   Processed: ${processedSitemaps.length}`);
    Logger.log(`   Current index: ${currentSitemapIndex}`);
    Logger.log(`   Progress: ${sitemapQueue.length > 0 ? ((processedSitemaps.length / sitemapQueue.length) * 100).toFixed(1) + '%' : 'N/A'}`);
    
    // Indexing progress
    const indexNowProgress = parseInt(props.getProperty("indexNow_processedSheets") || "0", 10);
    const googleProgress = parseInt(props.getProperty("google_processedSheets") || "0", 10);
    const googleCurrentLanguage = props.getProperty("google_current_language") || "Not active";
    const googleLanguageIndex = parseInt(props.getProperty("google_language_index") || "0", 10);
    
    Logger.log(`IndexNow Progress:`);
    Logger.log(`   Processed sheets: ${indexNowProgress}`);
    
    Logger.log(`Google Indexing Progress:`);
    Logger.log(`   Current language: ${googleCurrentLanguage}`);
    Logger.log(`   Language index: ${googleLanguageIndex}`);
    Logger.log(`   Processed sheets in current language: ${googleProgress}`);
    
    // Google rate limiting
    const googleSubmissions = parseInt(props.getProperty("google_submissions_today") || "0", 10);
    const lastSubmissionDate = props.getProperty("google_last_submission_date") || "Never";
    const today = getShortDate();
    
    Logger.log(`Google API Usage:`);
    Logger.log(`   Today's submissions: ${googleSubmissions}/200`);
    Logger.log(`   Last submission date: ${lastSubmissionDate}`);
    Logger.log(`   Rate limit status: ${googleSubmissions >= 200 && lastSubmissionDate === today ? 'REACHED' : 'OK'}`);
    
    // Last execution times
    const lastSitemap = props.getProperty("last_sitemap_run") || "Never";
    const lastIndexNow = props.getProperty("last_indexnow_run") || "Never";
    const lastGoogle = props.getProperty("last_google_run") || "Never";
    
    Logger.log(`Last Executions:`);
    Logger.log(`   Sitemap collection: ${lastSitemap !== 'Never' ? new Date(lastSitemap).toLocaleString() : 'Never'}`);
    Logger.log(`   IndexNow submission: ${lastIndexNow !== 'Never' ? new Date(lastIndexNow).toLocaleString() : 'Never'}`);
    Logger.log(`   Google indexing: ${lastGoogle !== 'Never' ? new Date(lastGoogle).toLocaleString() : 'Never'}`);
    
    return {
      sitemap: {
        queueSize: sitemapQueue.length,
        processed: processedSitemaps.length,
        currentIndex: currentSitemapIndex
      },
      indexing: {
        indexNowProgress: indexNowProgress,
        googleProgress: googleProgress,
        googleLanguage: googleCurrentLanguage
      },
      api: {
        googleSubmissions: googleSubmissions,
        lastSubmissionDate: lastSubmissionDate
      }
    };
    
  } catch (error) {
    Logger.log(`Error generating system status: ${error.message}`);
    return { error: error.message };
  }
}

/**
 * Validate system configuration with comprehensive checks
 */
function validateSystemConfiguration() {
  Logger.log("=== SYSTEM CONFIGURATION VALIDATION ===");
  
  const validation = {
    overall: 'UNKNOWN',
    issues: [],
    warnings: [],
    components: {}
  };
  
  try {
    // Check header configuration
    Logger.log("Validating header configuration...");
    if (!HEADER_ROW || !Array.isArray(HEADER_ROW) || HEADER_ROW.length === 0) {
      validation.issues.push("HEADER_ROW is not properly defined as array");
    } else if (HEADER_ROW.length < 8) {
      validation.issues.push(`HEADER_ROW has ${HEADER_ROW.length} columns, expected at least 8`);
    } else {
      const requiredColumns = ["Status", "URL", "Fetch Date"];
      const missingColumns = requiredColumns.filter(col => 
        !HEADER_ROW.some(header => header.includes(col))
      );
      if (missingColumns.length > 0) {
        validation.issues.push(`Missing required columns: ${missingColumns.join(', ')}`);
      } else {
        validation.components.headers = { status: 'OK', columns: HEADER_ROW.length };
      }
    }
    
    // Check submission interval
    Logger.log("Validating submission interval...");
    if (!SUBMISSION_INTERVAL_DAYS || typeof SUBMISSION_INTERVAL_DAYS !== 'number' || SUBMISSION_INTERVAL_DAYS < 1) {
      validation.issues.push("SUBMISSION_INTERVAL_DAYS must be a number >= 1");
    } else {
      validation.components.submissionInterval = { status: 'OK', days: SUBMISSION_INTERVAL_DAYS };
    }
    
    // Check IndexNow endpoints
    Logger.log("Validating IndexNow endpoints...");
    if (!INDEXNOW_ENDPOINTS || typeof INDEXNOW_ENDPOINTS !== 'object') {
      validation.issues.push("INDEXNOW_ENDPOINTS not defined as object");
    } else {
      const endpointCount = Object.keys(INDEXNOW_ENDPOINTS).length;
      if (endpointCount === 0) {
        validation.issues.push("INDEXNOW_ENDPOINTS is empty");
      } else {
        validation.components.indexnowEndpoints = { status: 'OK', count: endpointCount };
      }
    }
    
    // Check IndexNow API keys
    Logger.log("Validating IndexNow API keys...");
    if (!INDEXNOW_KEYS || typeof INDEXNOW_KEYS !== 'object') {
      validation.issues.push("INDEXNOW_KEYS not defined as object");
    } else {
      const totalKeys = Object.keys(INDEXNOW_KEYS).length;
      const validKeys = Object.values(INDEXNOW_KEYS).filter(key => 
        key && typeof key === 'string' && key.length > 10
      ).length;
      
      if (totalKeys === 0) {
        validation.issues.push("INDEXNOW_KEYS is empty");
      } else if (validKeys < totalKeys) {
        validation.warnings.push(`Only ${validKeys}/${totalKeys} IndexNow API keys appear valid`);
      }
      
      validation.components.indexnowKeys = { 
        status: validKeys === totalKeys ? 'OK' : 'WARNING',
        validKeys: validKeys,
        totalKeys: totalKeys
      };
    }
    
    // Check Google API credentials
    Logger.log("Validating Google API credentials...");
    if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
      validation.issues.push("Google API credentials (SERVICE_ACCOUNT_EMAIL or SERVICE_ACCOUNT_PRIVATE_KEY) missing");
    } else if (!SERVICE_ACCOUNT_EMAIL.includes('@')) {
      validation.issues.push("SERVICE_ACCOUNT_EMAIL appears invalid");
    } else if (!SERVICE_ACCOUNT_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) {
      validation.issues.push("SERVICE_ACCOUNT_PRIVATE_KEY appears invalid");
    } else {
      validation.components.googleCredentials = { status: 'OK' };
    }
    
    // Check sitemap configuration
    Logger.log("Validating sitemap configuration...");
    try {
      const sitemaps = getSitemapList();
      if (!Array.isArray(sitemaps) || sitemaps.length === 0) {
        validation.issues.push("getSitemapList() returns no sitemaps");
      } else {
        validation.components.sitemaps = { status: 'OK', count: sitemaps.length };
      }
    } catch (error) {
      validation.issues.push(`getSitemapList() error: ${error.message}`);
    }
    
    // Determine overall status
    if (validation.issues.length === 0) {
      validation.overall = validation.warnings.length === 0 ? 'VALID' : 'VALID_WITH_WARNINGS';
    } else {
      validation.overall = 'INVALID';
    }
    
    // Report results
    Logger.log(`Configuration Status: ${validation.overall}`);
    
    if (validation.issues.length > 0) {
      Logger.log("CRITICAL ISSUES:");
      validation.issues.forEach(issue => Logger.log(`   - ${issue}`));
    }
    
    if (validation.warnings.length > 0) {
      Logger.log("WARNINGS:");
      validation.warnings.forEach(warning => Logger.log(`   - ${warning}`));
    }
    
    if (validation.overall === 'VALID') {
      Logger.log("All configuration checks passed");
    }
    
    return validation;
    
  } catch (error) {
    Logger.log(`Critical error during configuration validation: ${error.message}`);
    validation.overall = 'ERROR';
    validation.issues.push(`Validation failed: ${error.message}`);
    return validation;
  }
}

/**
 * Recovery function to restore from emergency backup
 */
function recoverFromBackup(backupKey) {
  Logger.log(`ATTEMPTING RECOVERY FROM BACKUP: ${backupKey}`);
  
  try {
    if (!backupKey || typeof backupKey !== 'string') {
      Logger.log("Invalid backup key provided");
      return { success: false, error: "Invalid backup key" };
    }
    
    const props = PropertiesService.getScriptProperties();
    const backupData = props.getProperty(backupKey);
    
    if (!backupData) {
      Logger.log(`Backup not found: ${backupKey}`);
      return { success: false, error: "Backup not found" };
    }
    
    let backup;
    try {
      backup = JSON.parse(backupData);
    } catch (parseError) {
      Logger.log(`Invalid backup data format: ${parseError.message}`);
      return { success: false, error: "Invalid backup format" };
    }
    
    if (!backup.properties || typeof backup.properties !== 'object') {
      Logger.log("Backup does not contain valid properties data");
      return { success: false, error: "Invalid backup structure" };
    }
    
    Logger.log(`Restoring from backup created: ${backup.timestamp}`);
    Logger.log(`Restoring ${Object.keys(backup.properties).length} properties`);
    
    // Restore properties
    Object.entries(backup.properties).forEach(([key, value]) => {
      if (key !== backupKey) { // Don't overwrite the backup itself
        props.setProperty(key, value);
      }
    });
    
    Logger.log("Recovery completed successfully");
    return { 
      success: true, 
      restoredProperties: Object.keys(backup.properties).length,
      backupTimestamp: backup.timestamp
    };
    
  } catch (error) {
    Logger.log(`Critical error during recovery: ${error.message}`);
    return { success: false, error: error.message };
  }
}