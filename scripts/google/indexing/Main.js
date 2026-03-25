/**
 * @fileoverview Main entry points for the hierarchical indexing system
 * 
 * This module provides the primary functions that should be called by triggers
 * or manual execution. It integrates the hierarchical processing system with
 * the existing infrastructure.
 * 
 * @version 2.0.0
 * @requires IndexingOrchestrator
 * @requires SpreadsheetManagerV2
 */

/**
 * Main entry point for IndexNow indexing
 * This function should be called by the daily trigger
 */
function indexIndexNow() {
  Logger.log("=== INDEXNOW HIERARCHICAL PROCESSING ===");
  resetTimer();
  
  try {
    const orchestrator = new IndexingOrchestrator();
    const searchEngines = ["bing", "yandex", "naver", "seznam", "yep"];
    
    const result = orchestrator.indexIndexNowHierarchical(searchEngines);
    
    Logger.log("=== INDEXNOW SESSION COMPLETE ===");
    Logger.log(`Processed: ${result.processed} spreadsheets`);
    Logger.log(`Submitted: ${result.submitted} URLs`);
    
    if (result.completed) {
      Logger.log("🎉 ALL INDEXNOW PROCESSING COMPLETE!");
    } else if (result.currentTarget) {
      Logger.log(`Next target: ${result.currentTarget.subdomain}/${result.currentTarget.language}`);
    }
    
    return result;
    
  } catch (error) {
    Logger.log(`❌ CRITICAL ERROR: ${error.message}`);
    Logger.log(`Stack trace: ${error.stack}`);
    return { success: false, error: error.message };
  }
}

/**
 * Main entry point for Google indexing
 * This function should be called by the daily trigger
 */
function indexGoogle() {
  Logger.log("=== GOOGLE HIERARCHICAL PROCESSING ===");
  resetTimer();
  
  try {
    const orchestrator = new IndexingOrchestrator();
    const result = orchestrator.indexGoogleHierarchical();
    
    Logger.log("=== GOOGLE SESSION COMPLETE ===");
    Logger.log(`Processed: ${result.processed} spreadsheets`);
    Logger.log(`Submitted: ${result.submitted} URLs`);
    
    if (result.rateLimited) {
      Logger.log("⚠️ Rate limited - will resume tomorrow");
      scheduleNextGoogleRun();
    } else if (result.completed) {
      Logger.log("🎉 ALL GOOGLE PROCESSING COMPLETE!");
    } else if (result.currentTarget) {
      Logger.log(`Next target: ${result.currentTarget.subdomain}/en`);
    }
    
    return result;
    
  } catch (error) {
    Logger.log(`❌ CRITICAL ERROR: ${error.message}`);
    Logger.log(`Stack trace: ${error.stack}`);
    return { success: false, error: error.message };
  }
}

/**
 * Collects all URLs from sitemaps using hierarchical processing
 * This function should be called by the daily trigger
 */
function collectAllURLs() {
  Logger.log("=== SITEMAP COLLECTION (HIERARCHICAL) ===");
  resetTimer();
  
  try {
    const collector = new SitemapCollectorV2();
    const result = collector.collectSitemapsHierarchical();
    
    Logger.log("=== COLLECTION SESSION COMPLETE ===");
    Logger.log(`Processed: ${result.processed} sitemaps`);
    Logger.log(`URLs collected: ${result.urlsCollected}`);
    
    if (result.completed) {
      Logger.log("🎉 ALL SITEMAPS COLLECTED!");
      
      // Update properties to track completion
      const props = PropertiesService.getScriptProperties();
      props.setProperty("last_sitemap_run", new Date().toISOString());
      props.setProperty("last_collection_complete", new Date().toISOString());
    } else {
      const collector = new SitemapCollectorV2();
      const status = collector.getCollectionStatus();
      Logger.log(`Progress: ${status.percentComplete}% complete`);
      Logger.log(`Next run will continue from where we left off`);
      
      // Update last run time
      const props = PropertiesService.getScriptProperties();
      props.setProperty("last_sitemap_run", new Date().toISOString());
    }
    
    if (result.errors.length > 0) {
      Logger.log("⚠️ Some errors occurred:");
      result.errors.slice(0, 5).forEach(error => Logger.log(`   - ${error}`));
      if (result.errors.length > 5) {
        Logger.log(`   ... and ${result.errors.length - 5} more errors`);
      }
    }
    
    return result;
    
  } catch (error) {
    Logger.log(`⚠️ CRITICAL ERROR: ${error.message}`);
    Logger.log(`Stack trace: ${error.stack}`);
    return { success: false, error: error.message };
  }
}

/**
 * Manual restart function - clears collection progress and starts fresh
 */
function manualCollectAllURLs() {
  Logger.log("🔄 MANUAL COLLECTION RESTART");
  
  // Clear hierarchical collection progress
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('sitemap_queue_v2');
  props.deleteProperty('processed_sitemaps_v2'); 
  props.deleteProperty('current_sitemap_index_v2');
  props.deleteProperty('last_collection_complete');
  
  Logger.log("Collection progress cleared - starting fresh");
  
  // Start collection
  return collectAllURLs();
}

/**
 * Check collection progress
 */
function checkCollectionProgress() {
  const collector = new SitemapCollectorV2();
  const status = collector.getCollectionStatus();
  
  Logger.log("=== COLLECTION PROGRESS ===");
  Logger.log(`Total sitemaps: ${status.totalSitemaps}`);
  Logger.log(`Processed: ${status.processedSitemaps}`);
  Logger.log(`Current index: ${status.currentIndex}`);
  Logger.log(`Progress: ${status.percentComplete}%`);
  Logger.log(`Status: ${status.isComplete ? 'COMPLETE' : 'IN PROGRESS'}`);
  
  return status;
}

/**
 * Get detailed status of hierarchical processing
 */
function getHierarchicalStatus() {
  Logger.log("=== HIERARCHICAL PROCESSING STATUS ===");
  
  const props = PropertiesService.getScriptProperties();
  const spreadsheetManager = new SpreadsheetManagerV2();
  
  // Get hierarchy statistics
  const stats = spreadsheetManager.getProcessingStatistics();
  
  Logger.log(`📊 Total spreadsheets: ${stats.totalSpreadsheets}`);
  Logger.log("\n📂 By Subdomain:");
  Object.entries(stats.bySubdomain).forEach(([subdomain, count]) => {
    Logger.log(`   ${subdomain}: ${count} spreadsheets`);
  });
  
  
  Logger.log("\n🌍 By Language:");
  const topLanguages = Object.entries(stats.byLanguage)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5);
  topLanguages.forEach(([language, count]) => {
    Logger.log(`   ${language}: ${count} spreadsheets`);
  });
  
  // Get current progress
  const indexNowProgress = props.getProperty('indexnow_hierarchical_progress');
  const googleProgress = props.getProperty('google_hierarchical_progress');
  
  Logger.log("\n📈 Current Progress:");
  if (indexNowProgress) {
    const progress = JSON.parse(indexNowProgress);
    Logger.log(`   IndexNow: ${progress.subdomain}/${progress.language}`);
    if (progress.spreadsheetIndex) {
      Logger.log(`     Spreadsheet ${progress.spreadsheetIndex} in current target`);
    }
  } else {
    Logger.log(`   IndexNow: Not started or completed`);
  }
  
  if (googleProgress) {
    const progress = JSON.parse(googleProgress);
    Logger.log(`   Google: ${progress.subdomain}/en`);
    if (progress.spreadsheetIndex) {
      Logger.log(`     Spreadsheet ${progress.spreadsheetIndex} in current target`);
    }
  } else {
    Logger.log(`   Google: Not started or completed`);
  }
  
  // Get last completion times
  const lastIndexNow = props.getProperty('last_indexnow_complete');
  const lastGoogle = props.getProperty('last_google_complete');
  
  Logger.log("\n⏱️ Last Completions:");
  Logger.log(`   IndexNow: ${lastIndexNow || 'Never'}`);
  Logger.log(`   Google: ${lastGoogle || 'Never'}`);
  
  return {
    statistics: stats,
    indexNowProgress: indexNowProgress ? JSON.parse(indexNowProgress) : null,
    googleProgress: googleProgress ? JSON.parse(googleProgress) : null,
    lastCompletions: {
      indexNow: lastIndexNow,
      google: lastGoogle
    }
  };
}

/**
 * Reset hierarchical progress for a fresh start
 */
function resetHierarchicalProgress(service = 'both') {
  Logger.log(`🔄 Resetting hierarchical progress for: ${service}`);
  
  const props = PropertiesService.getScriptProperties();
  
  if (service === 'indexnow' || service === 'both') {
    props.deleteProperty('indexnow_hierarchical_progress');
    Logger.log("✅ IndexNow progress reset");
  }
  
  if (service === 'google' || service === 'both') {
    props.deleteProperty('google_hierarchical_progress');
    Logger.log("✅ Google progress reset");
  }
  
  Logger.log("Progress reset complete. Next run will start from beginning.");
}

/**
 * Test hierarchical processing with a specific target
 */
function testHierarchicalProcessing(subdomain = 'products', language = 'en') {
  Logger.log(`=== TESTING HIERARCHICAL PROCESSING ===`);
  Logger.log(`Target: ${subdomain}/${language}`);
  
  const spreadsheetManager = new SpreadsheetManagerV2();
  
  try {
    // Test getting spreadsheets for target
    const spreadsheets = spreadsheetManager.getSpreadsheetsByHierarchy(subdomain, language);
    
    Logger.log(`Found ${spreadsheets.length} spreadsheets`);
    
    if (spreadsheets.length > 0) {
      Logger.log("Sample spreadsheets:");
      spreadsheets.slice(0, 3).forEach((ss, index) => {
        const sheet = ss.getActiveSheet();
        const urls = sheet.getLastRow() - 1;
        Logger.log(`   ${index + 1}. ${ss.getName()} - ${urls} URLs`);
      });
    }
    
    // Test next target calculation
    const nextTarget = spreadsheetManager.getNextProcessingTarget({
      subdomain,
      language
    });
    
    if (nextTarget) {
      Logger.log(`Next target would be: ${nextTarget.subdomain}/${nextTarget.language}`);
    } else {
      Logger.log("No next target (this would be the last)");
    }
    
    return {
      success: true,
      spreadsheetCount: spreadsheets.length,
      nextTarget
    };
    
  } catch (error) {
    Logger.log(`❌ Test failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Stub for Google rate-limit recovery.
 * The daily trigger at 3 AM handles the next run automatically.
 */
function scheduleNextGoogleRun() {
  Logger.log("Google rate limited — daily trigger at 3 AM will handle next run");
}

/**
 * Analyze processing time estimates
 */
function analyzeProcessingTime() {
  Logger.log("=== PROCESSING TIME ANALYSIS ===");
  
  const spreadsheetManager = new SpreadsheetManagerV2();
  const stats = spreadsheetManager.getProcessingStatistics();
  
  // Estimates (adjust based on your actual performance)
  const SECONDS_PER_SPREADSHEET = 10;
  const SPREADSHEETS_PER_EXECUTION = 5;
  const EXECUTIONS_PER_DAY = 24; // If running hourly
  
  const totalTime = (stats.totalSpreadsheets * SECONDS_PER_SPREADSHEET) / 60;
  const totalExecutions = Math.ceil(stats.totalSpreadsheets / SPREADSHEETS_PER_EXECUTION);
  const daysNeeded = Math.ceil(totalExecutions / EXECUTIONS_PER_DAY);
  
  Logger.log(`📊 Analysis Results:`);
  Logger.log(`   Total spreadsheets: ${stats.totalSpreadsheets}`);
  Logger.log(`   Estimated total processing time: ${totalTime.toFixed(1)} minutes`);
  Logger.log(`   Total executions needed: ${totalExecutions}`);
  Logger.log(`   Days to complete (at ${EXECUTIONS_PER_DAY} runs/day): ${daysNeeded}`);
  
  Logger.log(`\n🎯 Optimization Notes:`);
  Logger.log(`   - Current batch size: ${SPREADSHEETS_PER_EXECUTION} spreadsheets/run`);
  Logger.log(`   - Hierarchical processing prevents timeouts`);
  Logger.log(`   - Progress saved between executions`);
  Logger.log(`   - Automatic resume from last position`);
  
  return {
    totalSpreadsheets: stats.totalSpreadsheets,
    estimatedMinutes: totalTime,
    executionsNeeded: totalExecutions,
    daysToComplete: daysNeeded
  };
}