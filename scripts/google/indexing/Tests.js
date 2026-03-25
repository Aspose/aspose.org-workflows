/**
 * @fileoverview Verification test suite for the aspose.org indexing system.
 * Run `runAllTests()` from the Apps Script editor to execute all tests.
 * Each suite can also be run individually (e.g., `testConfig()`).
 *
 * Web app endpoint and monitoring functions are in WebApp.js.
 */

/** Schedule a one-shot trigger to run tests with full permissions */
function scheduleTestRun() {
  // Clean up any previous test triggers and results
  clearTestTriggers();
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("test_run_status");
  props.deleteProperty("test_run_results");
  props.deleteProperty("test_run_start");

  // Create trigger that fires in ~1 minute
  ScriptApp.newTrigger("triggeredTestRun")
    .timeBased()
    .after(1)  // 1 millisecond — fires at next available slot (~30-60s)
    .create();
  Logger.log("Test trigger created. Results will be available in ~60 seconds.");
  return { status: "scheduled", message: "Run getTestResults() after ~60 seconds" };
}

/** Called by the time trigger — has full permissions including DriveApp */
function triggeredTestRun() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("test_run_status", "running");
  props.setProperty("test_run_start", new Date().toISOString());

  try {
    // Explicitly test DriveApp access in trigger context
    var driveTest = "untested";
    try {
      var root = DriveApp.getRootFolder();
      driveTest = "available (root: " + root.getName() + ")";
    } catch (de) {
      driveTest = "unavailable: " + de.message;
    }

    var unit = runAllTests();
    var integration = runIntegrationTests();
    var result = {
      unit: unit,
      integration: integration,
      totalPassed: unit.passed + integration.passed,
      totalFailed: unit.failed + integration.failed,
      allGreen: (unit.failed + integration.failed) === 0,
      driveAccess: driveTest,
      executionContext: "time-trigger",
      timestamp: new Date().toISOString()
    };
    props.setProperty("test_run_results", JSON.stringify(result));
    props.setProperty("test_run_status", "complete");
  } catch (e) {
    props.setProperty("test_run_results", JSON.stringify({ error: e.message, stack: e.stack }));
    props.setProperty("test_run_status", "error");
  }

  // Self-cleanup: remove the trigger that called us
  clearTestTriggers();
}

/** Retrieve test results stored by the trigger */
function getTestResults() {
  var props = PropertiesService.getScriptProperties();
  var status = props.getProperty("test_run_status");
  var results = props.getProperty("test_run_results");
  var start = props.getProperty("test_run_start");

  if (!status) return { status: "no_run", message: "No test run found. Call scheduleTestRun() first." };
  if (status === "running") return { status: "running", startedAt: start, message: "Tests still running. Try again in a moment." };

  return {
    status: status,
    startedAt: start,
    results: results ? JSON.parse(results) : null
  };
}

/** Remove all test-related triggers */
function clearTestTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "triggeredTestRun") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

/** Minimal Drive access diagnostic */
function testDriveAccess() {
  try {
    var rootFolder = DriveApp.getRootFolder();
    Logger.log("Root folder: " + rootFolder.getName());
    var folders = DriveApp.getFoldersByName("aspose-org-indexing");
    Logger.log("Search complete, hasNext: " + folders.hasNext());
    if (folders.hasNext()) {
      var f = folders.next();
      return { success: true, folderId: f.getId(), folderName: f.getName() };
    }
    return { success: true, folderId: null, message: "No 'aspose-org-indexing' folder found (will be created on first collection run)" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// === TEST HARNESS ===

class TestRunner {
  constructor(suiteName) {
    this.suite = suiteName;
    this.passed = [];
    this.failed = [];
    Logger.log("=== SUITE: " + suiteName + " ===");
  }

  assert(condition, label) {
    if (condition) {
      this.passed.push(label);
      Logger.log("  PASS: " + label);
    } else {
      this.failed.push(label);
      Logger.log("  FAIL: " + label);
    }
  }

  assertEqual(actual, expected, label) {
    if (actual === expected) {
      this.passed.push(label);
      Logger.log("  PASS: " + label);
    } else {
      this.failed.push(label + " (expected: " + JSON.stringify(expected) + ", got: " + JSON.stringify(actual) + ")");
      Logger.log("  FAIL: " + label + " (expected: " + JSON.stringify(expected) + ", got: " + JSON.stringify(actual) + ")");
    }
  }

  assertDeepEqual(actual, expected, label) {
    var a = JSON.stringify(actual);
    var e = JSON.stringify(expected);
    if (a === e) {
      this.passed.push(label);
      Logger.log("  PASS: " + label);
    } else {
      this.failed.push(label + " (expected: " + e + ", got: " + a + ")");
      Logger.log("  FAIL: " + label + " (expected: " + e + ", got: " + a + ")");
    }
  }

  assertMatch(str, regex, label) {
    var condition = regex.test(str);
    if (condition) {
      this.passed.push(label);
      Logger.log("  PASS: " + label);
    } else {
      this.failed.push(label + " ('" + str + "' did not match " + regex + ")");
      Logger.log("  FAIL: " + label + " ('" + str + "' did not match " + regex + ")");
    }
  }

  summary() {
    Logger.log("--- " + this.suite + ": " + this.passed.length + " passed, " + this.failed.length + " failed ---");
    if (this.failed.length > 0) {
      this.failed.forEach(function(f) { Logger.log("  FAILURE: " + f); });
    }
    return { suite: this.suite, passed: this.passed.length, failed: this.failed.length, failures: this.failed };
  }
}

// === MASTER RUNNER ===

function runAllTests() {
  Logger.log("========================================");
  Logger.log("  RUNNING ALL VERIFICATION TESTS");
  Logger.log("  " + new Date().toLocaleString());
  Logger.log("========================================\n");

  var suites = [
    testConfig,
    testUtilities,
    testSitemapCollector,
    testSitemapParser,
    testSpreadsheetManager,
    testOrchestrator,
    testIndexingAPI
  ];

  var totalPassed = 0;
  var totalFailed = 0;
  var allFailures = [];

  suites.forEach(function(suite) {
    try {
      var result = suite();
      totalPassed += result.passed;
      totalFailed += result.failed;
      if (result.failures.length > 0) {
        allFailures.push({ suite: result.suite, failures: result.failures });
      }
    } catch (error) {
      totalFailed++;
      allFailures.push({ suite: suite.name, failures: ["Suite crashed: " + error.message] });
      Logger.log("SUITE CRASH [" + suite.name + "]: " + error.message);
    }
    Logger.log("");
  });

  Logger.log("========================================");
  Logger.log("  FINAL RESULTS: " + totalPassed + " passed, " + totalFailed + " failed");
  Logger.log("========================================");

  if (allFailures.length > 0) {
    Logger.log("\nFAILURE SUMMARY:");
    allFailures.forEach(function(s) {
      Logger.log("  [" + s.suite + "]");
      s.failures.forEach(function(f) { Logger.log("    - " + f); });
    });
  } else {
    Logger.log("\nALL TESTS PASSED!");
  }

  return { passed: totalPassed, failed: totalFailed, failures: allFailures };
}

// === SUITE 1: CONFIGURATION ===

function testConfig() {
  var t = new TestRunner("Configuration");

  // HEADER_ROW
  t.assertEqual(HEADER_ROW.length, 8, "HEADER_ROW has 8 columns");
  t.assertEqual(HEADER_ROW[7], "URL", "Last column is 'URL'");
  t.assertEqual(HEADER_ROW[0], "Bing Status", "First column is 'Bing Status'");
  t.assertEqual(HEADER_ROW[5], "Google Status", "Column 6 is 'Google Status'");
  t.assertEqual(HEADER_ROW[6], "Fetch Date", "Column 7 is 'Fetch Date'");

  // Constants
  t.assert(typeof SUBMISSION_INTERVAL_DAYS === "number" && SUBMISSION_INTERVAL_DAYS > 0, "SUBMISSION_INTERVAL_DAYS is a positive number");
  t.assertEqual(SUBMISSION_INTERVAL_DAYS, 14, "SUBMISSION_INTERVAL_DAYS is 14");

  // IndexNow endpoints
  var expectedEngines = ["bing", "yandex", "naver", "seznam", "yep"];
  expectedEngines.forEach(function(engine) {
    t.assert(!!INDEXNOW_ENDPOINTS[engine], "INDEXNOW_ENDPOINTS has '" + engine + "'");
    t.assert(!!INDEXNOW_KEYS[engine], "INDEXNOW_KEYS has '" + engine + "'");
    t.assertMatch(INDEXNOW_ENDPOINTS[engine], /^https:\/\//, engine + " endpoint starts with https://");
  });

  // Service account (placeholders until aspose.org credentials are provided)
  t.assert(typeof SERVICE_ACCOUNT_EMAIL === "string" && SERVICE_ACCOUNT_EMAIL.length > 0, "SERVICE_ACCOUNT_EMAIL is defined");
  t.assert(typeof SERVICE_ACCOUNT_PRIVATE_KEY === "string" && SERVICE_ACCOUNT_PRIVATE_KEY.length > 0, "SERVICE_ACCOUNT_PRIVATE_KEY is defined");

  // getSitemapList()
  var sitemaps = getSitemapList();
  t.assert(Array.isArray(sitemaps), "getSitemapList() returns an array");
  t.assert(sitemaps.length > 0, "getSitemapList() returns non-empty array");

  // 4 subdomains * 37 languages + 3 root = 151
  t.assertEqual(sitemaps.length, 151, "getSitemapList() returns 151 sitemaps (4*37 + 3)");

  // Check structure
  var first = sitemaps[0];
  t.assert(!!first.url, "Sitemap entry has 'url' property");
  t.assert(!!first.name, "Sitemap entry has 'name' property");
  t.assert(!!first.subdomain, "Sitemap entry has 'subdomain' property");
  t.assert(!!first.language, "Sitemap entry has 'language' property");

  // Root sitemaps
  var roots = sitemaps.filter(function(s) { return s.language === "root"; });
  t.assertEqual(roots.length, 3, "3 root sitemaps (www, about, blog)");
  var rootNames = roots.map(function(s) { return s.subdomain; }).sort();
  t.assertDeepEqual(rootNames, ["about.aspose.org", "blog.aspose.org", "www.aspose.org"], "Root sitemaps are www, about, blog");

  // validateConfiguration() — may report credential placeholder warnings
  var validation = validateConfiguration();
  t.assert(typeof validation.valid === "boolean", "validateConfiguration() returns valid boolean");
  t.assert(Array.isArray(validation.errors), "validateConfiguration() returns errors array");

  return t.summary();
}

// === SUITE 2: UTILITIES ===

function testUtilities() {
  var t = new TestRunner("Utilities");

  // getShortDate()
  var today = getShortDate();
  t.assertEqual(typeof today, "string", "getShortDate() returns a string");
  t.assertMatch(today, /^\d{4}-\d{2}-\d{2}$/, "getShortDate() matches YYYY-MM-DD format");

  // getShortDateFromDate()
  t.assertEqual(getShortDateFromDate(new Date(2025, 0, 15)), "2025-01-15", "getShortDateFromDate(Jan 15 2025) = '2025-01-15'");
  t.assertEqual(getShortDateFromDate(new Date(2024, 11, 1)), "2024-12-01", "getShortDateFromDate(Dec 1 2024) = '2024-12-01'");
  // In GAS, getShortDateFromDate with non-Date input returns the string via String() coercion
  var nonDateResult = getShortDateFromDate("not-a-date");
  t.assertEqual(typeof nonDateResult, "string", "getShortDateFromDate(string) returns a string");

  // shouldResubmit()
  t.assertEqual(shouldResubmit(null), true, "shouldResubmit(null) = true");
  t.assertEqual(shouldResubmit(""), true, "shouldResubmit('') = true");
  t.assertEqual(shouldResubmit(undefined), true, "shouldResubmit(undefined) = true");
  t.assertEqual(shouldResubmit("Pending"), true, "shouldResubmit('Pending') = true");
  t.assertEqual(shouldResubmit(getShortDate()), false, "shouldResubmit(today) = false");
  t.assertEqual(shouldResubmit("2020-01-01"), true, "shouldResubmit('2020-01-01') = true (old date)");
  t.assertEqual(shouldResubmit("2099-01-01"), false, "shouldResubmit('2099-01-01') = false (future date)");
  t.assertEqual(shouldResubmit("garbage"), true, "shouldResubmit('garbage') = true (unrecognized)");

  // shouldResubmit with recent date (within 14 days)
  var recentDate = new Date();
  recentDate.setDate(recentDate.getDate() - 5);
  var recentStr = getShortDateFromDate(recentDate);
  t.assertEqual(shouldResubmit(recentStr), false, "shouldResubmit(5 days ago) = false");

  // shouldResubmit with old date (beyond 14 days)
  var oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 20);
  var oldStr = getShortDateFromDate(oldDate);
  t.assertEqual(shouldResubmit(oldStr), true, "shouldResubmit(20 days ago) = true");

  // hasLangCode()
  t.assertEqual(hasLangCode("https://products.aspose.org/de/cells/"), true, "hasLangCode with /de/ = true");
  t.assertEqual(hasLangCode("https://products.aspose.org/ja/cells/"), true, "hasLangCode with /ja/ = true");
  t.assertEqual(hasLangCode("https://products.aspose.org/en/cells/"), false, "hasLangCode with /en/ = false (en excluded)");
  t.assertEqual(hasLangCode("https://www.aspose.org/about"), false, "hasLangCode without lang = false");
  t.assertEqual(hasLangCode(""), false, "hasLangCode('') = false");
  t.assertEqual(hasLangCode(null), false, "hasLangCode(null) = false");

  return t.summary();
}

// === SUITE 3: SITEMAP COLLECTOR ===

function testSitemapCollector() {
  var t = new TestRunner("SitemapCollector");

  var collector = new SitemapCollectorV2();

  // extractHierarchyFromUrl()
  var h1 = collector.extractHierarchyFromUrl("https://products.aspose.org/en/sitemap.xml");
  t.assertDeepEqual(h1, { subdomain: "products", language: "en" }, "extractHierarchy: products/en");

  var h2 = collector.extractHierarchyFromUrl("https://docs.aspose.org/de/sitemap.xml");
  t.assertDeepEqual(h2, { subdomain: "docs", language: "de" }, "extractHierarchy: docs/de");

  var h3 = collector.extractHierarchyFromUrl("https://www.aspose.org/sitemap.xml");
  t.assertEqual(h3.subdomain, "www", "extractHierarchy root: subdomain = 'www'");
  t.assertEqual(h3.language, "root", "extractHierarchy root: language = 'root'");

  var h4 = collector.extractHierarchyFromUrl("https://blog.aspose.org/sitemap.xml");
  t.assertEqual(h4.subdomain, "blog", "extractHierarchy blog: subdomain = 'blog'");
  t.assertEqual(h4.language, "root", "extractHierarchy blog: language = 'root'");

  var h5 = collector.extractHierarchyFromUrl("https://kb.aspose.org/ja/sitemap.xml");
  t.assertDeepEqual(h5, { subdomain: "kb", language: "ja" }, "extractHierarchy: kb/ja");

  // initializeSitemapQueue()
  var queue = collector.initializeSitemapQueue();
  t.assert(Array.isArray(queue), "initializeSitemapQueue() returns an array");
  t.assertEqual(queue.length, 151, "Queue has 151 entries (4*37 + 3)");

  // All URLs are strings starting with https://
  var allValid = queue.every(function(url) { return typeof url === "string" && url.indexOf("https://") === 0; });
  t.assert(allValid, "All queue URLs start with https://");

  // All URLs end with .xml
  var allXml = queue.every(function(url) { return url.indexOf(".xml") === url.length - 4; });
  t.assert(allXml, "All queue URLs end with .xml");

  // English prioritized first
  t.assert(queue[0].indexOf("/en/") !== -1, "First URL in queue contains /en/ (English prioritized)");

  // Priority ordering: products before reference
  var firstProducts = queue.findIndex(function(u) { return u.indexOf("products.") !== -1; });
  var firstReference = queue.findIndex(function(u) { return u.indexOf("reference.") !== -1; });
  t.assert(firstProducts < firstReference, "Products URLs appear before reference URLs (priority order)");

  return t.summary();
}

// === SUITE 4: SITEMAP PARSER ===

function testSitemapParser() {
  var t = new TestRunner("SitemapParser");

  var parser = new SitemapParser();

  // isValidUrl()
  t.assertEqual(parser.isValidUrl("https://products.aspose.org/en/cells/"), true, "isValidUrl: valid HTTPS URL");
  t.assertEqual(parser.isValidUrl("http://example.com"), true, "isValidUrl: valid HTTP URL");
  t.assertEqual(parser.isValidUrl("ftp://invalid.com"), false, "isValidUrl: FTP rejected");
  t.assertEqual(parser.isValidUrl(""), false, "isValidUrl: empty string rejected");
  t.assertEqual(parser.isValidUrl(null), false, "isValidUrl: null rejected");
  t.assertEqual(parser.isValidUrl("not a url"), false, "isValidUrl: plain text rejected");
  t.assertEqual(parser.isValidUrl("https://example.com/path with spaces"), false, "isValidUrl: URL with spaces rejected");

  // Long URL
  var longUrl = "https://example.com/" + Array(2002).join("a");
  t.assertEqual(parser.isValidUrl(longUrl), false, "isValidUrl: URL > 2000 chars rejected");

  // isValidSitemapUrl()
  t.assertEqual(parser.isValidSitemapUrl("https://example.com/sitemap.xml"), true, "isValidSitemapUrl: valid sitemap URL");
  t.assertEqual(parser.isValidSitemapUrl("https://example.com/page.html"), false, "isValidSitemapUrl: non-XML rejected");
  t.assertEqual(parser.isValidSitemapUrl(""), false, "isValidSitemapUrl: empty rejected");
  t.assertEqual(parser.isValidSitemapUrl("https://example.com/data.xml"), true, "isValidSitemapUrl: any .xml accepted");

  // isValidContentType()
  t.assertEqual(parser.isValidContentType("text/xml"), true, "isValidContentType: text/xml");
  t.assertEqual(parser.isValidContentType("application/xml; charset=utf-8"), true, "isValidContentType: application/xml with charset");
  t.assertEqual(parser.isValidContentType("text/html"), false, "isValidContentType: text/html rejected");
  t.assertEqual(parser.isValidContentType(null), true, "isValidContentType: null allowed");

  // cleanXmlContent()
  var withBom = "\uFEFF<?xml version=\"1.0\"?><urlset/>";
  var cleaned = parser.cleanXmlContent(withBom);
  t.assert(cleaned.charCodeAt(0) !== 0xFEFF, "cleanXmlContent: BOM stripped");

  var noDecl = "<urlset></urlset>";
  var withDecl = parser.cleanXmlContent(noDecl);
  t.assert(withDecl.indexOf("<?xml") === 0, "cleanXmlContent: XML declaration prepended when missing");

  var alreadyValid = "<?xml version=\"1.0\"?><urlset/>";
  t.assertEqual(parser.cleanXmlContent(alreadyValid), alreadyValid, "cleanXmlContent: valid XML unchanged");

  // Cache methods
  parser.setCachedResult("test_key", { type: "urlset", urls: ["a"] });
  var cached = parser.getCachedResult("test_key");
  t.assertDeepEqual(cached, { type: "urlset", urls: ["a"] }, "Cache roundtrip works");
  t.assertEqual(parser.getCachedResult("nonexistent_key"), null, "Cache miss returns null");

  // calculateDelay()
  var delay1 = parser.calculateDelay(1);
  t.assert(typeof delay1 === "number" && delay1 >= 1000, "calculateDelay(1) >= 1000ms");
  var delay3 = parser.calculateDelay(3);
  t.assert(delay3 > delay1 - 1000, "calculateDelay(3) > calculateDelay(1) (exponential, allowing jitter)");

  return t.summary();
}

// === SUITE 5: SPREADSHEET MANAGER ===

function testSpreadsheetManager() {
  var t = new TestRunner("SpreadsheetManager");

  var mgr = new SpreadsheetManagerV2();

  // parseSpreadsheetName()
  t.assertDeepEqual(mgr.parseSpreadsheetName("products_en_indexing"), { subdomain: "products", language: "en" }, "parseName: products_en_indexing");
  t.assertDeepEqual(mgr.parseSpreadsheetName("docs_de_indexing"), { subdomain: "docs", language: "de" }, "parseName: docs_de_indexing");
  t.assertDeepEqual(mgr.parseSpreadsheetName("kb_ja_indexing"), { subdomain: "kb", language: "ja" }, "parseName: kb_ja_indexing");

  var rootResult = mgr.parseSpreadsheetName("www_indexing");
  t.assertEqual(rootResult.subdomain, "www", "parseName root: subdomain = 'www'");
  t.assertEqual(rootResult.language, "root", "parseName root: language = 'root'");

  // 3-part names (aspose.net legacy format) must be rejected
  t.assertEqual(mgr.parseSpreadsheetName("products_cells_en_indexing"), null, "parseName: 3-part name rejected (aspose.net format)");
  t.assertEqual(mgr.parseSpreadsheetName("docs_words_de_indexing"), null, "parseName: 3-part name rejected (legacy)");

  t.assertEqual(mgr.parseSpreadsheetName(""), null, "parseName: empty string = null");
  t.assertEqual(mgr.parseSpreadsheetName(null), null, "parseName: null = null");
  t.assertEqual(mgr.parseSpreadsheetName(123), null, "parseName: number = null");

  // HIERARCHY constants
  t.assertEqual(mgr.HIERARCHY.subdomains.length, 7, "HIERARCHY has 7 subdomains");
  t.assertDeepEqual(
    mgr.HIERARCHY.subdomains,
    ["products", "docs", "kb", "reference", "www", "about", "blog"],
    "HIERARCHY subdomains in expected order"
  );
  t.assertEqual(mgr.HIERARCHY.languages.length, 37, "HIERARCHY has 37 languages");
  t.assertEqual(mgr.HIERARCHY.languages[0], "en", "HIERARCHY languages starts with 'en'");

  // hasSpreadsheets()
  var mockHierarchy = {
    products: { en: { count: 2, fileIds: ["a", "b"] }, de: { count: 0, fileIds: [] } },
    docs: {}
  };
  t.assertEqual(mgr.hasSpreadsheets(mockHierarchy, "products", "en"), true, "hasSpreadsheets: products/en with count=2");
  t.assertEqual(mgr.hasSpreadsheets(mockHierarchy, "products", "de"), false, "hasSpreadsheets: products/de with count=0");
  t.assertEqual(mgr.hasSpreadsheets(mockHierarchy, "docs", "en"), false, "hasSpreadsheets: docs/en (missing)");
  t.assertEqual(mgr.hasSpreadsheets(mockHierarchy, "nonexistent", "en"), false, "hasSpreadsheets: nonexistent subdomain");

  // findFirstAvailableTarget() with empty hierarchy
  var emptyHierarchy = {};
  mgr.HIERARCHY.subdomains.forEach(function(s) { emptyHierarchy[s] = {}; });
  t.assertEqual(mgr.findFirstAvailableTarget(emptyHierarchy), null, "findFirstAvailableTarget: empty hierarchy = null");

  // findFirstAvailableTarget() with data
  var testHierarchy = {};
  mgr.HIERARCHY.subdomains.forEach(function(s) { testHierarchy[s] = {}; });
  testHierarchy["docs"]["fr"] = { count: 1, fileIds: ["x"] };
  var firstTarget = mgr.findFirstAvailableTarget(testHierarchy);
  t.assertDeepEqual(firstTarget, { subdomain: "docs", language: "fr" }, "findFirstAvailableTarget: finds docs/fr");

  return t.summary();
}

// === SUITE 6: ORCHESTRATOR ===

function testOrchestrator() {
  var t = new TestRunner("Orchestrator");

  var orch = new IndexingOrchestrator();

  // getHostDomain()
  t.assertEqual(orch.getHostDomain("products"), "products.aspose.org", "getHostDomain: products");
  t.assertEqual(orch.getHostDomain("docs"), "docs.aspose.org", "getHostDomain: docs");
  t.assertEqual(orch.getHostDomain("kb"), "kb.aspose.org", "getHostDomain: kb");
  t.assertEqual(orch.getHostDomain("reference"), "reference.aspose.org", "getHostDomain: reference");
  t.assertEqual(orch.getHostDomain("www"), "www.aspose.org", "getHostDomain: www");
  t.assertEqual(orch.getHostDomain("about"), "about.aspose.org", "getHostDomain: about");
  t.assertEqual(orch.getHostDomain("blog"), "blog.aspose.org", "getHostDomain: blog");
  t.assertEqual(orch.getHostDomain("unknown"), "www.aspose.org", "getHostDomain: unknown falls back to www");

  // HEADER_ROW column index mapping
  var bingCol = HEADER_ROW.findIndex(function(h) { return h.toLowerCase().includes("bing"); });
  t.assertEqual(bingCol, 0, "Bing column index = 0");

  var yandexCol = HEADER_ROW.findIndex(function(h) { return h.toLowerCase().includes("yandex"); });
  t.assertEqual(yandexCol, 1, "Yandex column index = 1");

  var naverCol = HEADER_ROW.findIndex(function(h) { return h.toLowerCase().includes("naver"); });
  t.assertEqual(naverCol, 2, "Naver column index = 2");

  var seznamCol = HEADER_ROW.findIndex(function(h) { return h.toLowerCase().includes("seznam"); });
  t.assertEqual(seznamCol, 3, "Seznam column index = 3");

  var yepCol = HEADER_ROW.findIndex(function(h) { return h.toLowerCase().includes("yep"); });
  t.assertEqual(yepCol, 4, "Yep column index = 4");

  var googleCol = HEADER_ROW.findIndex(function(h) { return h.toLowerCase().includes("google"); });
  t.assertEqual(googleCol, 5, "Google column index = 5");

  var urlCol = HEADER_ROW.findIndex(function(h) { return h.toLowerCase() === "url"; });
  t.assertEqual(urlCol, 7, "URL column index = 7");

  // Progress load/save/clear roundtrip (uses test-prefixed keys)
  var props = PropertiesService.getScriptProperties();
  var testKey = "test_verification_roundtrip";
  try {
    props.setProperty(testKey, JSON.stringify({ subdomain: "products", language: "en" }));
    var loaded = JSON.parse(props.getProperty(testKey));
    t.assertDeepEqual(loaded, { subdomain: "products", language: "en" }, "PropertiesService roundtrip works");
  } finally {
    props.deleteProperty(testKey);
  }

  return t.summary();
}

// === SUITE 7: INDEXING API ===

function testIndexingAPI() {
  var t = new TestRunner("IndexingAPI");

  var api = new IndexingAPI();

  // submitToIndexNow input validation (these all return before making HTTP calls)
  var r1 = api.submitToIndexNow(null, ["url"], "host");
  t.assertEqual(r1.success, false, "submitToIndexNow: null engine = failure");

  var r2 = api.submitToIndexNow("bing", [], "host");
  t.assertEqual(r2.success, false, "submitToIndexNow: empty urls = failure");

  var r3 = api.submitToIndexNow("bing", null, "host");
  t.assertEqual(r3.success, false, "submitToIndexNow: null urls = failure");

  var r4 = api.submitToIndexNow("bing", ["url"], null);
  t.assertEqual(r4.success, false, "submitToIndexNow: null hostDomain = failure");

  var r5 = api.submitToIndexNow("nonexistent_engine", ["url"], "host");
  t.assertEqual(r5.success, false, "submitToIndexNow: nonexistent engine = failure");

  // submitBatchGoogle input validation
  var g1 = api.submitBatchGoogle([], "token");
  t.assertEqual(g1.success, false, "submitBatchGoogle: empty urls = failure");

  var g2 = api.submitBatchGoogle(null, "token");
  t.assertEqual(g2.success, false, "submitBatchGoogle: null urls = failure");

  var g3 = api.submitBatchGoogle(["url"], null);
  t.assertEqual(g3.success, false, "submitBatchGoogle: null token = failure");

  return t.summary();
}

// === INTEGRATION TESTS (calls real services) ===

function runIntegrationTests() {
  Logger.log("========================================");
  Logger.log("  RUNNING INTEGRATION TESTS");
  Logger.log("  (These call real Google services)");
  Logger.log("  " + new Date().toLocaleString());
  Logger.log("========================================\n");

  var t = new TestRunner("Integration");

  // 1. Configuration validation (may fail due to credential placeholders)
  try {
    var config = validateConfiguration();
    t.assert(typeof config.valid === "boolean", "validateConfiguration() runs without crash");
  } catch (e) {
    t.assert(false, "validateConfiguration() threw: " + e.message);
  }

  // 2. Google API authentication (skip if placeholder credentials)
  var hasRealCredentials = SERVICE_ACCOUNT_PRIVATE_KEY.indexOf("BEGIN PRIVATE KEY") !== -1;
  if (hasRealCredentials) {
    try {
      var api = new IndexingAPI();
      var token = api.getServiceAccountToken();
      t.assert(!!token, "Google API token obtained successfully");
    } catch (e) {
      t.assert(false, "Google API auth threw: " + e.message);
    }

    // 3. Google rate limit check
    try {
      var api2 = new IndexingAPI();
      var rateStatus = api2.checkGoogleRateLimit();
      t.assert(typeof rateStatus.submissionsToday === "number", "Google rate limit returns submissionsToday");
      t.assert(typeof rateStatus.limitReached === "boolean", "Google rate limit returns limitReached");
    } catch (e) {
      t.assert(false, "Google rate limit check threw: " + e.message);
    }
  } else {
    Logger.log("  SKIP: Google API tests (placeholder credentials)");
    t.assert(true, "Google API tests skipped (placeholder credentials)");
    t.assert(true, "Google rate limit test skipped (placeholder credentials)");
  }

  // 4. Drive REST API access
  var mgr = new SpreadsheetManagerV2();
  var folderName = mgr.FOLDER_NAME; // "aspose-org-indexing"
  var indexingFolderId = null;
  try {
    var token = ScriptApp.getOAuthToken();
    var query = encodeURIComponent("name='" + folderName + "' and mimeType='application/vnd.google-apps.folder' and trashed=false");
    var resp = UrlFetchApp.fetch(
      "https://www.googleapis.com/drive/v3/files?q=" + query + "&fields=files(id,name)",
      { headers: { Authorization: "Bearer " + token }, muteHttpExceptions: true }
    );
    var respCode = resp.getResponseCode();
    var respBody = resp.getContentText();
    var data = JSON.parse(respBody);
    if (respCode !== 200) {
      Logger.log("  DEBUG: Drive API HTTP " + respCode + ": " + respBody.substring(0, 500));
    }
    t.assert(respCode === 200, "Drive REST API returns 200 (got " + respCode + ")");
    // Folder may not exist yet (created on first collectAllURLs run)
    if (data.files && data.files.length > 0) {
      indexingFolderId = data.files[0].id;
      t.assertEqual(data.files[0].name, folderName, "Indexing folder name is '" + folderName + "'");
      Logger.log("  INFO: Indexing folder ID: " + indexingFolderId);
    } else {
      Logger.log("  INFO: Folder '" + folderName + "' not yet created (run collectAllURLs first)");
      t.assert(true, "Drive API query succeeded (folder will be created on first collection run)");
    }
  } catch (e) {
    t.assert(false, "Drive REST API folder query threw: " + e.message);
  }

  // 5. Spreadsheet hierarchy via Drive REST API (only if folder exists)
  if (indexingFolderId) {
    try {
      var token2 = ScriptApp.getOAuthToken();
      var sheetsQuery = encodeURIComponent(
        "'" + indexingFolderId + "' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
      );
      var resp2 = UrlFetchApp.fetch(
        "https://www.googleapis.com/drive/v3/files?q=" + sheetsQuery + "&fields=files(id,name)&pageSize=1000",
        { headers: { Authorization: "Bearer " + token2 }, muteHttpExceptions: true }
      );
      var sheetsData = JSON.parse(resp2.getContentText());
      t.assert(resp2.getResponseCode() === 200, "Drive REST API spreadsheet list returns 200");
      Logger.log("  INFO: " + (sheetsData.files ? sheetsData.files.length : 0) + " spreadsheets found via REST API");

      if (sheetsData.files && sheetsData.files.length > 0) {
        var validNames = sheetsData.files.filter(function(f) {
          return mgr.parseSpreadsheetName(f.name) !== null;
        });
        t.assert(validNames.length > 0, "Spreadsheets follow naming convention ({subdomain}_{lang}_indexing)");
        Logger.log("  INFO: " + validNames.length + "/" + sheetsData.files.length + " match naming convention");
      } else {
        t.assert(true, "No spreadsheets yet (folder is new)");
      }
    } catch (e) {
      t.assert(false, "Drive REST API spreadsheet query threw: " + e.message);
    }
  }

  // 6. Trigger status
  try {
    var triggers = ScriptApp.getProjectTriggers();
    Logger.log("  INFO: " + triggers.length + " triggers found");
    t.assert(triggers.length >= 0, "Trigger query successful");

    var triggerFunctions = triggers.map(function(tr) { return tr.getHandlerFunction(); });
    var expected = ["collectAllURLs", "indexIndexNow", "indexGoogle"];
    expected.forEach(function(fn) {
      var found = triggerFunctions.indexOf(fn) !== -1;
      if (found) {
        t.assert(true, "Trigger exists for " + fn);
      } else {
        Logger.log("  WARNING: No trigger for " + fn);
        t.assert(false, "Missing trigger for " + fn);
      }
    });
  } catch (e) {
    t.assert(false, "Trigger check threw: " + e.message);
  }

  // 7. Sample sitemap accessibility
  try {
    var parser = new SitemapParser();
    var testResult = parser.testSitemapAccess("https://products.aspose.org/en/sitemap.xml");
    t.assertEqual(testResult.accessible, true, "products.aspose.org/en/sitemap.xml is accessible");
    Logger.log("  INFO: HTTP " + testResult.responseCode + ", " + testResult.contentType);
  } catch (e) {
    t.assert(false, "Sitemap access test threw: " + e.message);
  }

  var result = t.summary();

  Logger.log("\n========================================");
  Logger.log("  INTEGRATION: " + result.passed + " passed, " + result.failed + " failed");
  Logger.log("========================================");

  return result;
}
