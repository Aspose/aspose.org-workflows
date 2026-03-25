/**
 * @fileoverview Sitemap collection module for aspose.org.
 *
 * Collects URLs from sitemaps and organises them into spreadsheets.
 * Hierarchy: subdomain -> language (no family dimension).
 * Sitemap pattern: https://{subdomain}.aspose.org/{lang}/sitemap.xml
 *
 * @version 3.0.0
 */

class SitemapCollectorV2 {
  constructor() {
    this.spreadsheetManager = new SpreadsheetManagerV2();
    this.sitemapParser = new SitemapParser();
    this.props = PropertiesService.getScriptProperties();
    this.MAX_SITEMAPS_PER_RUN = 10;
    this.EXECUTION_TIME_LIMIT = 240000; // 4 minutes
  }

  collectSitemapsHierarchical() {
    Logger.log("=== STARTING SITEMAP COLLECTION (aspose.org) ===");
    const startTime = Date.now();
    const results = { success: false, processed: 0, urlsCollected: 0, errors: [], completed: false };

    try {
      let sitemapQueue = this.getSitemapQueue();
      let processedSitemaps = this.getProcessedSitemaps();
      let currentIndex = this.getCurrentSitemapIndex();

      if (!sitemapQueue || sitemapQueue.length === 0) {
        sitemapQueue = this.initializeSitemapQueue();
        processedSitemaps = [];
        currentIndex = 0;
        Logger.log("Initialized sitemap queue: " + sitemapQueue.length + " sitemaps");
      }

      Logger.log("Resuming from index " + currentIndex + "/" + sitemapQueue.length);
      let processed = 0;

      while (currentIndex < sitemapQueue.length && processed < this.MAX_SITEMAPS_PER_RUN) {
        if (Date.now() - startTime > this.EXECUTION_TIME_LIMIT) {
          Logger.log("Time limit approaching, saving progress");
          this.saveProgress(sitemapQueue, processedSitemaps, currentIndex);
          results.success = true;
          return results;
        }

        const sitemapUrl = sitemapQueue[currentIndex];

        if (!processedSitemaps.includes(sitemapUrl)) {
          const processResult = this.processSitemap(sitemapUrl, sitemapQueue);
          if (processResult.success) {
            results.urlsCollected += processResult.urlCount;
            processedSitemaps.push(sitemapUrl);
            processed++;
            results.processed++;
          } else {
            results.errors.push("Failed: " + sitemapUrl);
          }
        }
        currentIndex++;
      }

      this.saveProgress(sitemapQueue, processedSitemaps, currentIndex);

      if (currentIndex >= sitemapQueue.length) {
        Logger.log("ALL SITEMAPS PROCESSED!");
        this.clearCollectionProgress();
        results.completed = true;
      } else {
        Logger.log("Progress: " + currentIndex + "/" + sitemapQueue.length + " sitemaps");
      }

      results.success = true;
    } catch (error) {
      Logger.log("ERROR in sitemap collection: " + error.message);
      results.errors.push(error.message);
    }
    return results;
  }

  processSitemap(sitemapUrl, sitemapQueue) {
    Logger.log("Processing: " + sitemapUrl);
    try {
      const result = this.sitemapParser.fetchAndParseSitemap(sitemapUrl, sitemapQueue);

      if (result.type === "urlset" && result.urls && result.urls.length > 0) {
        const hierarchy = this.extractHierarchyFromUrl(sitemapUrl);
        if (!hierarchy) {
          Logger.log("Could not determine hierarchy for: " + sitemapUrl);
          return { success: false, urlCount: 0 };
        }
        const spreadsheet = this.getOrCreateSpreadsheet(hierarchy);
        const addResult = this.addUrlsToSpreadsheet(spreadsheet, result.urls);
        Logger.log("Added " + addResult.newUrls + " new URLs to " + spreadsheet.getName());
        return { success: true, urlCount: result.urls.length, newUrls: addResult.newUrls, hierarchy };

      } else if (result.type === "sitemapindex") {
        Logger.log("Sitemap index with " + result.childCount + " child sitemaps");
        return { success: true, urlCount: 0 };

      } else {
        Logger.log("No URLs found in sitemap");
        return { success: false, urlCount: 0 };
      }
    } catch (error) {
      Logger.log("Error processing sitemap: " + error.message);
      return { success: false, urlCount: 0, error: error.message };
    }
  }

  /**
   * Extract hierarchy from aspose.org sitemap URL.
   * Pattern: https://{subdomain}.aspose.org/{lang}/sitemap.xml
   *      or: https://{subdomain}.aspose.org/sitemap.xml  (root)
   */
  extractHierarchyFromUrl(sitemapUrl) {
    try {
      const cleanUrl = sitemapUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/sitemap\.xml$/, "");
      const parts = cleanUrl.split("/");
      const subdomain = parts[0].split(".")[0];
      if (parts.length >= 2) {
        return { subdomain, language: parts[1] };
      } else {
        return { subdomain, language: "root" };
      }
    } catch (error) {
      Logger.log("Error parsing sitemap URL: " + error.message);
      return null;
    }
  }

  /**
   * Get or create spreadsheet for subdomain+language.
   * Name pattern: {subdomain}_{language}_indexing
   */
  getOrCreateSpreadsheet(hierarchy) {
    const spreadsheetName = hierarchy.subdomain + "_" + hierarchy.language + "_indexing";
    const folder = this.spreadsheetManager.getIndexingFolder();

    const files = folder.getFilesByName(spreadsheetName);
    if (files.hasNext()) {
      return SpreadsheetApp.openById(files.next().getId());
    }

    Logger.log("Creating spreadsheet: " + spreadsheetName);
    const spreadsheet = SpreadsheetApp.create(spreadsheetName);
    const file = DriveApp.getFileById(spreadsheet.getId());
    folder.addFile(file);
    DriveApp.getRootFolder().removeFile(file);

    const sheet = spreadsheet.getActiveSheet();
    sheet.setName("URLs");
    sheet.appendRow(HEADER_ROW);
    const headerRange = sheet.getRange(1, 1, 1, HEADER_ROW.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#f0f0f0");
    sheet.setColumnWidth(8, 400);
    for (let i = 1; i <= 6; i++) sheet.setColumnWidth(i, 120);
    sheet.setColumnWidth(7, 100);

    return spreadsheet;
  }

  addUrlsToSpreadsheet(spreadsheet, urls) {
    const sheet = spreadsheet.getActiveSheet();
    const lastRow = sheet.getLastRow();
    const existingUrls = new Set();
    if (lastRow > 1) {
      sheet.getRange(2, 8, lastRow - 1, 1).getValues().forEach(row => {
        if (row[0]) existingUrls.add(row[0]);
      });
    }
    const currentDate = getShortDate();
    const newRows = [];
    urls.forEach(url => {
      if (!existingUrls.has(url)) {
        newRows.push(["Pending", "Pending", "Pending", "Pending", "Pending", "Pending", currentDate, url]);
      }
    });
    if (newRows.length > 0) {
      const batchSize = 500;
      for (let i = 0; i < newRows.length; i += batchSize) {
        const batch = newRows.slice(i, i + batchSize);
        sheet.getRange(sheet.getLastRow() + 1, 1, batch.length, HEADER_ROW.length).setValues(batch);
      }
    }
    return { newUrls: newRows.length, duplicates: urls.length - newRows.length, totalUrls: sheet.getLastRow() - 1 };
  }

  /**
   * Build the initial sitemap queue for aspose.org.
   * Two-level: subdomain x language (no family).
   */
  initializeSitemapQueue() {
    const sitemaps = [];
    const subdomains = ["products", "kb", "reference", "docs"];
    const languages = [
      "en", "de", "es", "fr", "ja", "ko", "ru", "zh", "ar", "it", "pt", "pl", "fa", "id", "cs", "vi", "tr", "th",
      "sv", "el", "uk", "bg", "sr", "da", "fi", "he", "hi", "hu", "lv", "ms", "nl", "no", "lt", "ca", "hr", "ro", "sk"
    ];

    subdomains.forEach(subdomain => {
      languages.forEach(language => {
        sitemaps.push({
          url: "https://" + subdomain + ".aspose.org/" + language + "/sitemap.xml",
          hierarchy: { subdomain, language }
        });
      });
    });

    ["www", "about", "blog"].forEach(site => {
      sitemaps.push({
        url: "https://" + site + ".aspose.org/sitemap.xml",
        hierarchy: { subdomain: site, language: "root" }
      });
    });

    const subdomainPriority = { products: 1, docs: 2, kb: 3, reference: 4, www: 5, about: 6, blog: 7 };
    sitemaps.sort((a, b) => {
      if (a.hierarchy.language === "en" && b.hierarchy.language !== "en") return -1;
      if (a.hierarchy.language !== "en" && b.hierarchy.language === "en") return 1;
      return (subdomainPriority[a.hierarchy.subdomain] || 99) - (subdomainPriority[b.hierarchy.subdomain] || 99);
    });

    return sitemaps.map(s => s.url);
  }

  getSitemapQueue() {
    const saved = this.props.getProperty("sitemap_queue_v2");
    return saved ? JSON.parse(saved) : null;
  }
  getProcessedSitemaps() {
    const saved = this.props.getProperty("processed_sitemaps_v2");
    return saved ? JSON.parse(saved) : [];
  }
  getCurrentSitemapIndex() {
    return parseInt(this.props.getProperty("current_sitemap_index_v2") || "0", 10);
  }
  saveProgress(queue, processed, index) {
    this.props.setProperties({
      "sitemap_queue_v2": JSON.stringify(queue),
      "processed_sitemaps_v2": JSON.stringify(processed),
      "current_sitemap_index_v2": index.toString()
    });
  }
  clearCollectionProgress() {
    this.props.deleteProperty("sitemap_queue_v2");
    this.props.deleteProperty("processed_sitemaps_v2");
    this.props.deleteProperty("current_sitemap_index_v2");
    this.props.setProperty("last_collection_complete", new Date().toISOString());
  }
  getCollectionStatus() {
    const queue = this.getSitemapQueue() || [];
    const processed = this.getProcessedSitemaps() || [];
    const index = this.getCurrentSitemapIndex();
    return {
      totalSitemaps: queue.length,
      processedSitemaps: processed.length,
      currentIndex: index,
      percentComplete: queue.length > 0 ? ((processed.length / queue.length) * 100).toFixed(1) : 0,
      isComplete: index >= queue.length
    };
  }
}

// collectAllURLs() is defined in Main.js (single definition to avoid GAS namespace conflict)
