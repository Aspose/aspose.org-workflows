/**
 * @fileoverview Web app endpoints and monitoring for aspose.org indexing.
 *
 * Provides:
 *   doGet()                — web app entry point (?action=unit|integration|status|all)
 *   getIndexingStatus()    — cached URL count reader (instant)
 *   refreshIndexingStatus()— chunked URL count computation (~100 per trigger batch)
 *
 * @version 1.0.0
 */

/** Web app entry point — runs tests or returns status */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "all";
  var result;

  switch (action) {
    case "unit":
      result = runAllTests();
      break;
    case "integration":
      result = runIntegrationTests();
      break;
    case "status":
      var sub = (e && e.parameter && e.parameter.subdomain) || null;
      result = getIndexingStatus(sub);
      break;
    case "all":
    default:
      var unit = runAllTests();
      var integration = runIntegrationTests();
      result = {
        unit: unit,
        integration: integration,
        totalPassed: unit.passed + integration.passed,
        totalFailed: unit.failed + integration.failed,
        allGreen: (unit.failed + integration.failed) === 0,
        timestamp: new Date().toISOString()
      };
      break;
  }

  return ContentService
    .createTextOutput(JSON.stringify(result, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Reads cached status (instant). Use ?action=status
 * To refresh the cache: clasp run refreshIndexingStatus
 */
function getIndexingStatus() {
  var props = PropertiesService.getScriptProperties();

  var progress = {
    indexNow: safeJsonParse(props.getProperty("indexnow_hierarchical_progress")),
    google: safeJsonParse(props.getProperty("google_hierarchical_progress")),
    lastIndexNowComplete: props.getProperty("last_indexnow_complete") || null,
    lastGoogleComplete: props.getProperty("last_google_complete") || null,
    lastCollectionComplete: props.getProperty("last_collection_complete") || null
  };

  var cached = props.getProperty("cached_status_urlcounts");
  if (cached) {
    var result = JSON.parse(cached);
    result.progress = progress;
    return result;
  }

  // No cache — return spreadsheet counts from Drive API (fast fallback)
  var token = ScriptApp.getOAuthToken();
  var mgr = new SpreadsheetManagerV2();
  var folderId = props.getProperty("indexing_folder_id");
  if (!folderId) {
    var folderName = mgr.FOLDER_NAME;
    var q = encodeURIComponent("name='" + folderName + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    var resp = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id)", {
      headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      var d = JSON.parse(resp.getContentText());
      if (d.files && d.files.length > 0) folderId = d.files[0].id;
    }
  }

  if (!folderId) {
    return { totalSpreadsheets: 0, bySubdomain: {}, byLanguage: {}, progress: progress,
             note: "Indexing folder not found. Run collectAllURLs to create it.",
             timestamp: new Date().toISOString() };
  }

  var allFiles = listDriveFiles(folderId, token);
  var counts = countByName(allFiles);
  counts.progress = progress;
  counts.note = "Showing spreadsheet counts only. Run refreshIndexingStatus to get URL counts.";
  counts.timestamp = new Date().toISOString();
  return counts;
}

/**
 * Chunked URL count refresh — processes ~100 spreadsheets per run.
 * Auto-reschedules until all are done. Call once via clasp run or trigger.
 */
function refreshIndexingStatus() {
  var CHUNK_SIZE = 100;
  var token = ScriptApp.getOAuthToken();
  var props = PropertiesService.getScriptProperties();
  var mgr = new SpreadsheetManagerV2();
  var folderId = props.getProperty("indexing_folder_id");
  if (!folderId) {
    var folderName = mgr.FOLDER_NAME;
    var q = encodeURIComponent("name='" + folderName + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    var resp = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=files(id)", {
      headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      var d = JSON.parse(resp.getContentText());
      if (d.files && d.files.length > 0) folderId = d.files[0].id;
    }
  }

  var state = safeJsonParse(props.getProperty("status_refresh_state"));
  if (!state || !state.files) {
    var allFiles = listDriveFiles(folderId, token);
    var fileList = [];
    allFiles.forEach(function(f) {
      var parsed = mgr.parseSpreadsheetName(f.name);
      if (parsed) fileList.push({ id: f.id, sub: parsed.subdomain, lang: parsed.language });
    });
    state = {
      files: fileList,
      index: 0,
      subdomainURLs: {},
      languageURLs: {},
      details: {},
      totalURLs: 0,
      totalSpreadsheets: allFiles.length,
      processed: 0
    };
  }

  var end = Math.min(state.index + CHUNK_SIZE, state.files.length);
  for (var i = state.index; i < end; i++) {
    var item = state.files[i];
    try {
      var ss = SpreadsheetApp.openById(item.id);
      var lastRow = ss.getSheets()[0].getLastRow();
      var count = lastRow > 1 ? lastRow - 1 : 0;
      if (!state.subdomainURLs[item.sub]) state.subdomainURLs[item.sub] = 0;
      state.subdomainURLs[item.sub] += count;
      if (!state.languageURLs[item.lang]) state.languageURLs[item.lang] = 0;
      state.languageURLs[item.lang] += count;
      state.totalURLs += count;
      var key = item.sub + "|" + item.lang;
      if (!state.details[key]) state.details[key] = { subdomain: item.sub, language: item.lang, urls: 0, spreadsheets: 0 };
      state.details[key].urls += count;
      state.details[key].spreadsheets++;
      state.processed++;
    } catch (e) { state.processed++; }
  }
  state.index = end;

  if (state.index < state.files.length) {
    props.setProperty("status_refresh_state", JSON.stringify(state));
    scheduleStatusRefresh_();
    var pct = Math.round(state.index / state.files.length * 100);
    Logger.log("Status refresh: " + pct + "% (" + state.index + "/" + state.files.length + ")");
    return { status: "in_progress", processed: state.index, total: state.files.length, percent: pct };
  }

  var details = Object.keys(state.details).map(function(k) { return state.details[k]; })
    .filter(function(d) { return d.urls > 0; })
    .sort(function(a, b) { return b.urls - a.urls; });

  var result = {
    totalURLs: state.totalURLs,
    totalSpreadsheets: state.totalSpreadsheets,
    spreadsheetsProcessed: state.processed,
    bySubdomain: state.subdomainURLs,
    byLanguage: state.languageURLs,
    details: details,
    cachedAt: new Date().toISOString()
  };

  props.setProperty("cached_status_urlcounts", JSON.stringify(result));
  props.deleteProperty("status_refresh_state");
  Logger.log("Status refresh complete: " + state.totalURLs + " total URLs in " + state.processed + " spreadsheets");
  return result;
}

/** Schedule next chunk of refreshIndexingStatus */
function scheduleStatusRefresh_() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "refreshIndexingStatus") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("refreshIndexingStatus").timeBased().after(1).create();
}

/** Start the refresh process. Call via clasp run. */
function scheduleStatusRefresh() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("status_refresh_state");
  props.deleteProperty("cached_status_urlcounts");
  scheduleStatusRefresh_();
  return { status: "scheduled", message: "URL count refresh started. Will process ~100 spreadsheets per batch. Check ?action=status for results." };
}

// --- helpers ---
function listDriveFiles(folderId, token) {
  var allFiles = [];
  if (!folderId) return allFiles;
  var pageToken = null;
  do {
    var q = encodeURIComponent("'" + folderId + "' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    var url = "https://www.googleapis.com/drive/v3/files?q=" + q + "&fields=nextPageToken,files(id,name)&pageSize=1000";
    if (pageToken) url += "&pageToken=" + pageToken;
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var page = JSON.parse(resp.getContentText());
      allFiles = allFiles.concat(page.files || []);
      pageToken = page.nextPageToken;
    } else { pageToken = null; }
  } while (pageToken);
  return allFiles;
}

function countByName(allFiles) {
  var mgr = new SpreadsheetManagerV2();
  var subdomainCounts = {};
  var languageCounts = {};
  mgr.HIERARCHY.subdomains.forEach(function(s) { subdomainCounts[s] = 0; });
  allFiles.forEach(function(file) {
    var parsed = mgr.parseSpreadsheetName(file.name);
    if (!parsed) return;
    if (!subdomainCounts[parsed.subdomain]) subdomainCounts[parsed.subdomain] = 0;
    subdomainCounts[parsed.subdomain]++;
    if (!languageCounts[parsed.language]) languageCounts[parsed.language] = 0;
    languageCounts[parsed.language]++;
  });
  return { totalSpreadsheets: allFiles.length, bySubdomain: subdomainCounts, byLanguage: languageCounts };
}

function safeJsonParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch (e) { return null; }
}
