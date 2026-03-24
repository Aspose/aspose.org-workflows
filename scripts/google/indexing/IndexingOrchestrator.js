/**
 * IndexingOrchestrator for aspose.org.
 * Two-level hierarchy: subdomain -> language (no family).
 * @version 3.0.0
 */

class IndexingOrchestrator {
  constructor() {
    this.spreadsheetManager = new SpreadsheetManagerV2();
    this.indexingAPI = new IndexingAPI();
    this.props = PropertiesService.getScriptProperties();
    this.MAX_URLS_PER_BATCH = 100;
    this.MAX_SPREADSHEETS_PER_RUN = 5;
    this.EXECUTION_TIME_LIMIT = 240000;
  }

  indexIndexNowHierarchical(searchEngines) {
    searchEngines = searchEngines || ["bing", "yandex", "naver", "seznam", "yep"];
    Logger.log("=== INDEXNOW HIERARCHICAL INDEXING (aspose.org) ===");
    const startTime = Date.now();
    const results = { success: false, processed: 0, submitted: 0, errors: [], currentTarget: null, completed: false };

    try {
      const progress = this.loadIndexNowProgress();
      const checkpoint = this.loadIndexNowCheckpoint();
      const target = this.spreadsheetManager.getNextProcessingTarget(
        checkpoint && checkpoint.subdomain ? checkpoint : progress
      );

      if (!target) {
        Logger.log("ALL INDEXNOW TARGETS COMPLETE!");
        this.clearIndexNowProgress();
        this.clearIndexNowCheckpoint();
        results.completed = true;
        results.success = true;
        return results;
      }

      results.currentTarget = target;
      const hostDomain = this.getHostDomain(target.subdomain);
      const spreadsheets = this.spreadsheetManager.getSpreadsheetsByHierarchy(target.subdomain, target.language);

      if (!spreadsheets || spreadsheets.length === 0) {
        Logger.log("No spreadsheets for " + target.subdomain + "/" + target.language);
        this.saveIndexNowProgress(target);
        results.success = true;
        return results;
      }

      let sIndex = 0, eIndexStart = 0, urlOffsetStart = 0;
      if (checkpoint && checkpoint.subdomain === target.subdomain && checkpoint.language === target.language) {
        sIndex = checkpoint.spreadsheetIndex || 0;
        eIndexStart = checkpoint.engineIndex || 0;
        urlOffsetStart = checkpoint.urlOffset || 0;
        Logger.log("Resuming at spreadsheetIndex=" + sIndex + ", engineIndex=" + eIndexStart + ", urlOffset=" + urlOffsetStart);
      }

      for (let i = sIndex; i < spreadsheets.length; i++) {
        const spreadsheet = spreadsheets[i];
        const processResult = this.processSpreadsheetForIndexNow(spreadsheet, searchEngines, hostDomain, {
          engineIndex: (i === sIndex) ? eIndexStart : 0,
          urlOffset: (i === sIndex) ? urlOffsetStart : 0,
          saveCheckpoint: (cp) => {
            this.saveIndexNowCheckpoint({
              subdomain: target.subdomain, language: target.language,
              spreadsheetIndex: i, engineIndex: cp.engineIndex, urlOffset: cp.urlOffset
            });
          },
          isTimeUp: () => (Date.now() - startTime) > (this.EXECUTION_TIME_LIMIT - 5000)
        });

        results.processed++;
        results.submitted += processResult.submitted;

        if (processResult.stoppedDueToTime) {
          Logger.log("Time nearly up - checkpoint saved.");
          results.success = true;
          return results;
        }
        Logger.log("Processed " + spreadsheet.getName() + ": " + processResult.submitted + " URLs submitted");
      }

      this.clearIndexNowCheckpoint();
      Logger.log("Completed target: " + target.subdomain + "/" + target.language);
      this.saveIndexNowProgress(target);
      results.success = true;
      return results;

    } catch (error) {
      Logger.log("INDEXNOW ERROR: " + error.message + "\n" + error.stack);
      results.errors.push(error.message);
      return results;
    }
  }

  indexGoogleHierarchical() {
    Logger.log("=== GOOGLE HIERARCHICAL INDEXING (aspose.org) ===");
    const startTime = Date.now();
    const results = { success: false, processed: 0, submitted: 0, errors: [], currentTarget: null, completed: false, rateLimited: false };

    try {
      const rateStatus = this.indexingAPI.checkGoogleRateLimit();
      if (rateStatus.limitReached) { results.rateLimited = true; return results; }

      const token = this.indexingAPI.getServiceAccountToken();
      if (!token) { results.errors.push("Authentication failed"); return results; }

      const progress = this.loadGoogleProgress();
      const target = this.getNextGoogleTarget(progress);

      if (!target) {
        Logger.log("ALL ENGLISH SPREADSHEETS PROCESSED!");
        this.clearGoogleProgress();
        results.completed = true;
        results.success = true;
        return results;
      }

      results.currentTarget = target;
      Logger.log("Processing: " + target.subdomain + "/en");
      const spreadsheets = this.spreadsheetManager.getSpreadsheetsByHierarchy(target.subdomain, "en");

      if (spreadsheets.length === 0) {
        Logger.log("No English spreadsheets for " + target.subdomain + ", skipping");
        this.saveGoogleProgress(target);
        return this.indexGoogleHierarchical();
      }

      const remainingQuota = 200 - rateStatus.submissionsToday;
      let processedInTarget = progress.spreadsheetIndex || 0;

      for (let i = processedInTarget; i < spreadsheets.length; i++) {
        if (Date.now() - startTime > this.EXECUTION_TIME_LIMIT) {
          this.saveGoogleProgress(Object.assign({}, target, { spreadsheetIndex: i }));
          results.success = true;
          return results;
        }
        if (results.processed >= this.MAX_SPREADSHEETS_PER_RUN) {
          this.saveGoogleProgress(Object.assign({}, target, { spreadsheetIndex: i }));
          results.success = true;
          return results;
        }
        if (results.submitted >= remainingQuota) {
          this.saveGoogleProgress(Object.assign({}, target, { spreadsheetIndex: i }));
          results.rateLimited = true;
          results.success = true;
          return results;
        }

        const processResult = this.processSpreadsheetForGoogle(spreadsheets[i], token, remainingQuota - results.submitted);
        results.processed++;
        results.submitted += processResult.submitted;

        if (processResult.rateLimited) {
          this.saveGoogleProgress(Object.assign({}, target, { spreadsheetIndex: i }));
          results.rateLimited = true;
          results.success = true;
          return results;
        }
        Logger.log("Processed " + spreadsheets[i].getName() + ": " + processResult.submitted + " submitted");
      }

      Logger.log("Completed: " + target.subdomain + "/en");
      this.saveGoogleProgress(target);

      if (Date.now() - startTime < this.EXECUTION_TIME_LIMIT &&
          results.processed < this.MAX_SPREADSHEETS_PER_RUN &&
          results.submitted < remainingQuota) {
        return this.indexGoogleHierarchical();
      }

      results.success = true;

    } catch (error) {
      Logger.log("GOOGLE INDEXING ERROR: " + error.message);
      results.errors.push(error.message);
    }
    return results;
  }

  processSpreadsheetForIndexNow(spreadsheet, searchEngines, hostDomain, resumeOpts) {
    resumeOpts = resumeOpts || {};
    const sheet = spreadsheet.getActiveSheet();
    let totalSubmitted = 0;
    const startEngine = Math.max(0, resumeOpts.engineIndex || 0);

    for (let e = startEngine; e < searchEngines.length; e++) {
      const engine = searchEngines[e];
      const urls = this.getUrlsForIndexing(sheet, engine);
      if (!urls || urls.length === 0) continue;
      const startOffset = (e === startEngine) ? Math.max(0, resumeOpts.urlOffset || 0) : 0;

      for (let i = startOffset; i < urls.length; i += this.MAX_URLS_PER_BATCH) {
        if (resumeOpts.isTimeUp && resumeOpts.isTimeUp()) {
          if (resumeOpts.saveCheckpoint) resumeOpts.saveCheckpoint({ engineIndex: e, urlOffset: i });
          return { submitted: totalSubmitted, stoppedDueToTime: true };
        }
        const batch = urls.slice(i, i + this.MAX_URLS_PER_BATCH);
        const result = this.indexingAPI.submitToIndexNow(engine, batch, hostDomain);
        if (result && result.success && result.submittedUrls && result.submittedUrls.length > 0) {
          if (this.updateIndexingStatus(sheet, engine, result.submittedUrls)) {
            totalSubmitted += result.submittedUrls.length;
          }
        }
        if (resumeOpts.saveCheckpoint) {
          resumeOpts.saveCheckpoint({ engineIndex: e, urlOffset: i + this.MAX_URLS_PER_BATCH });
        }
      }
    }
    return { submitted: totalSubmitted, stoppedDueToTime: false };
  }

  processSpreadsheetForGoogle(spreadsheet, token, remainingQuota) {
    const sheet = spreadsheet.getActiveSheet();
    const urls = this.getUrlsForIndexing(sheet, "Google");
    if (urls.length === 0) return { submitted: 0, rateLimited: false };
    const urlsToProcess = Math.min(urls.length, remainingQuota);
    let totalSubmitted = 0;

    for (let i = 0; i < urlsToProcess; i += 10) {
      const batch = urls.slice(i, Math.min(i + 10, urlsToProcess));
      const result = this.indexingAPI.submitBatchGoogle(batch, token);
      if (result.rateLimited) return { submitted: totalSubmitted, rateLimited: true };
      if (result.success && result.submittedUrls && result.submittedUrls.length > 0) {
        if (this.updateIndexingStatus(sheet, "Google", result.submittedUrls)) {
          this.indexingAPI.updateGoogleUsageCounter(result.submittedUrls.length);
          totalSubmitted += result.submittedUrls.length;
        }
      }
    }
    return { submitted: totalSubmitted, rateLimited: false };
  }

  getNextGoogleTarget(currentProgress) {
    const hierarchy = this.spreadsheetManager.getSpreadsheetHierarchy();
    const subdomains = this.spreadsheetManager.HIERARCHY.subdomains;
    let subdomainIndex = currentProgress.subdomain ? subdomains.indexOf(currentProgress.subdomain) : 0;
    if (currentProgress.subdomain && !currentProgress.spreadsheetIndex) subdomainIndex++;
    for (let i = subdomainIndex; i < subdomains.length; i++) {
      if (this.spreadsheetManager.hasSpreadsheets(hierarchy, subdomains[i], "en")) {
        return { subdomain: subdomains[i] };
      }
    }
    return null;
  }

  getHostDomain(subdomain) {
    const map = {
      products: "products.aspose.org", docs: "docs.aspose.org", kb: "kb.aspose.org",
      reference: "reference.aspose.org", www: "www.aspose.org", about: "about.aspose.org", blog: "blog.aspose.org"
    };
    return map[subdomain] || "www.aspose.org";
  }

  getHostDomainForSubdomain(subdomain) { return this.getHostDomain(subdomain); }

  getUrlsForIndexing(sheet, engine) {
    const colIndex = HEADER_ROW.findIndex(h => h.toLowerCase().includes(engine.toLowerCase()));
    if (colIndex === -1) return [];
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    const data = sheet.getRange(2, 1, lastRow - 1, HEADER_ROW.length).getValues();
    const eligibleUrls = [];
    data.forEach(row => {
      const status = row[colIndex];
      const url = row[7];
      if (url && shouldResubmit(status)) {
        if (engine.toLowerCase() === "google" && !hasLangCode(url)) eligibleUrls.push(url);
        else if (engine.toLowerCase() !== "google") eligibleUrls.push(url);
      }
    });
    return eligibleUrls;
  }

  updateIndexingStatus(sheet, engine, urls) {
    try {
      if (!urls || urls.length === 0) return false;
      const colIndex = HEADER_ROW.findIndex(h => h.toLowerCase().includes(engine.toLowerCase()));
      if (colIndex === -1) return false;
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) return false;
      const urlColIndex = HEADER_ROW.findIndex(h => h.toLowerCase() === "url");
      if (urlColIndex === -1) return false;
      const dataRange = sheet.getRange(2, 1, lastRow - 1, HEADER_ROW.length);
      const values = dataRange.getValues();
      const ok = new Set(urls.map(u => String(u).trim()));
      sheet.getRange(2, colIndex + 1, lastRow - 1, 1).setNumberFormat("@");
      const dateString = getShortDate();
      let updated = 0;
      for (let r = 0; r < values.length; r++) {
        const url = String(values[r][urlColIndex] || "").trim();
        if (ok.has(url)) { values[r][colIndex] = dateString; updated++; }
      }
      if (updated === 0) return false;
      dataRange.setValues(values);
      Logger.log("Updated " + updated + " " + engine + " cells to " + dateString);
      return true;
    } catch (error) {
      Logger.log("Error updating status for " + engine + ": " + error.message);
      return false;
    }
  }

  loadIndexNowProgress() {
    const s = this.props.getProperty("indexnow_hierarchical_progress");
    return s ? JSON.parse(s) : {};
  }
  saveIndexNowProgress(p) { this.props.setProperty("indexnow_hierarchical_progress", JSON.stringify(p)); }
  clearIndexNowProgress() {
    this.props.deleteProperty("indexnow_hierarchical_progress");
    this.props.setProperty("last_indexnow_complete", new Date().toISOString());
  }
  loadGoogleProgress() {
    const s = this.props.getProperty("google_hierarchical_progress");
    return s ? JSON.parse(s) : {};
  }
  saveGoogleProgress(p) { this.props.setProperty("google_hierarchical_progress", JSON.stringify(p)); }
  clearGoogleProgress() {
    this.props.deleteProperty("google_hierarchical_progress");
    this.props.setProperty("last_google_complete", new Date().toISOString());
  }
  loadIndexNowCheckpoint() {
    const s = this.props.getProperty("indexnow_checkpoint");
    return s ? JSON.parse(s) : null;
  }
  saveIndexNowCheckpoint(cp) { this.props.setProperty("indexnow_checkpoint", JSON.stringify(cp)); }
  clearIndexNowCheckpoint() { this.props.deleteProperty("indexnow_checkpoint"); }
}
