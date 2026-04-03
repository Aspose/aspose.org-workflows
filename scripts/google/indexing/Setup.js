/**
 * @fileoverview Setup and state management for aspose.org indexing.
 *
 * Run resetForAsposeOrg() once after deploying the separated codebase
 * to clear all stale ScriptProperties left over from aspose.net.
 */

/**
 * Clears all stale ScriptProperties from the previous aspose.net setup
 * and prepares a clean state for aspose.org indexing.
 *
 * Run once via: clasp run resetForAsposeOrg
 */
function resetForAsposeOrg() {
  Logger.log("=== RESETTING STATE FOR ASPOSE.ORG ===");
  var props = PropertiesService.getScriptProperties();

  var keysToDelete = [
    // Old folder reference (points to aspose.net "indexing" folder)
    "indexing_folder_id",
    // Indexing progress
    "indexnow_hierarchical_progress",
    "google_hierarchical_progress",
    "indexnow_checkpoint",
    // Cached status data (contains aspose.net counts)
    "cached_status_urlcounts",
    "status_refresh_state",
    // Collection progress
    "sitemap_queue_v2",
    "processed_sitemaps_v2",
    "current_sitemap_index_v2",
    // Completion timestamps (from aspose.net runs)
    "last_collection_complete",
    "last_indexnow_complete",
    "last_google_complete",
    "last_sitemap_run",
    // Test run state
    "test_run_status",
    "test_run_results",
    "test_run_start",
    // Google submission counters
    "google_submissions_today",
    "google_last_submission_date"
  ];

  var cleared = [];
  keysToDelete.forEach(function(key) {
    var value = props.getProperty(key);
    if (value !== null) {
      props.deleteProperty(key);
      cleared.push(key);
      Logger.log("  Cleared: " + key);
    }
  });

  Logger.log("=== RESET COMPLETE ===");
  Logger.log("Cleared " + cleared.length + " properties out of " + keysToDelete.length + " checked.");
  Logger.log("Next steps:");
  Logger.log("  1. Run collectAllURLs to create the aspose-org-indexing folder and start collecting");
  Logger.log("  2. Update Config.js with real aspose.org credentials when available");
  Logger.log("  3. Set up daily triggers via setupDailyTriggers()");

  return {
    cleared: cleared,
    totalChecked: keysToDelete.length,
    message: "State reset complete. Ready for aspose.org indexing."
  };
}

/**
 * Stores aspose.org credentials in ScriptProperties so they are never
 * hardcoded in source files.
 *
 * In GitHub Actions: call this after `clasp push` using secrets:
 *   clasp run setCredentials \
 *     --params '["$EMAIL", "$KEY", "$INDEXNOW"]'
 *
 * Locally (one-time setup):
 *   clasp run setCredentials \
 *     --params '["<email>", "<private_key>", "<indexnow_key>"]'
 */
function setCredentials(serviceAccountEmail, serviceAccountPrivateKey, indexNowKey) {
  var props = PropertiesService.getScriptProperties();
  var set = [];
  if (serviceAccountEmail) {
    props.setProperty('SERVICE_ACCOUNT_EMAIL', serviceAccountEmail);
    set.push('SERVICE_ACCOUNT_EMAIL');
  }
  if (serviceAccountPrivateKey) {
    props.setProperty('SERVICE_ACCOUNT_PRIVATE_KEY', serviceAccountPrivateKey);
    set.push('SERVICE_ACCOUNT_PRIVATE_KEY');
  }
  if (indexNowKey) {
    props.setProperty('INDEXNOW_KEY', indexNowKey);
    set.push('INDEXNOW_KEY');
  }
  Logger.log('setCredentials: stored ' + set.join(', '));
  return { success: true, stored: set };
}

/**
 * Diagnostic: read first few rows from a spreadsheet to verify status columns.
 * Usage: clasp run verifySpreadsheetData
 */
function verifySpreadsheetData() {
  var mgr = new SpreadsheetManagerV2();
  var results = [];

  // Check a sample of English spreadsheets
  var subdomains = ["products", "kb", "reference", "about"];
  subdomains.forEach(function(sub) {
    try {
      var spreadsheets = mgr.getSpreadsheetsByHierarchy(sub, "en");
      if (spreadsheets.length === 0) {
        results.push({ subdomain: sub, language: "en", status: "no spreadsheet" });
        return;
      }
      var ss = spreadsheets[0];
      var sheet = ss.getActiveSheet();
      var lastRow = sheet.getLastRow();
      var urlCount = lastRow > 1 ? lastRow - 1 : 0;
      var sample = [];
      if (lastRow >= 2) {
        var rows = sheet.getRange(2, 1, Math.min(3, lastRow - 1), HEADER_ROW.length).getValues();
        rows.forEach(function(row) {
          sample.push(
            "bing=" + String(row[0]) + " | yandex=" + String(row[1]) + " | naver=" + String(row[2]) +
            " | seznam=" + String(row[3]) + " | yep=" + String(row[4]) + " | google=" + String(row[5]) +
            " | date=" + String(row[6]) + " | url=" + String(row[7])
          );
        });
      }
      results.push({
        subdomain: sub, language: "en", spreadsheet: ss.getName(),
        urlCount: urlCount, sampleRows: sample
      });
    } catch (e) {
      results.push({ subdomain: sub, language: "en", error: e.message });
    }
  });

  return results;
}
