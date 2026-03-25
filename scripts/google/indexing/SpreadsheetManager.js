/**
 * SpreadsheetManager for aspose.org indexing.
 * Hierarchy: subdomain -> language (no family dimension).
 * @version 3.0.0
 */

class SpreadsheetManagerV2 {
  constructor() {
    this.FOLDER_NAME = "aspose-org-indexing";
    this.folderCache = null;
    this.cacheExpiry = 5 * 60 * 1000;
    this.lastFolderCacheTime = 0;
    this.hierarchyCache = { subdomains: null, spreadsheets: new Map() };

    this.HIERARCHY = {
      subdomains: ["products", "docs", "kb", "reference", "www", "about", "blog"],
      languages: [
        "en", "de", "es", "fr", "ja", "ko", "ru", "zh", "ar", "it", "pt", "pl", "fa", "id", "cs", "vi", "tr", "th",
        "sv", "el", "uk", "bg", "sr", "da", "fi", "he", "hi", "hu", "lv", "ms", "nl", "no", "lt", "ca", "hr", "ro", "sk"
      ]
    };
  }

  getIndexingFolder() {
    if (this.folderCache && (Date.now() - this.lastFolderCacheTime) < this.cacheExpiry) return this.folderCache;
    try {
      // Try cached folder ID first (avoids full Drive search)
      var props = PropertiesService.getScriptProperties();
      var cachedFolderId = props.getProperty("indexing_folder_id");
      if (cachedFolderId) {
        try {
          this.folderCache = DriveApp.getFolderById(cachedFolderId);
          this.lastFolderCacheTime = Date.now();
          return this.folderCache;
        } catch (e) {
          Logger.log("Cached folder ID invalid, searching by name");
          props.deleteProperty("indexing_folder_id");
        }
      }
      // Fall back to name search
      var folders = DriveApp.getFoldersByName(this.FOLDER_NAME);
      this.folderCache = folders.hasNext() ? folders.next() : DriveApp.createFolder(this.FOLDER_NAME);
      this.lastFolderCacheTime = Date.now();
      // Cache the folder ID for future use
      props.setProperty("indexing_folder_id", this.folderCache.getId());
      Logger.log("Indexing folder: " + this.folderCache.getId());
      return this.folderCache;
    } catch (error) {
      throw new Error("Failed to access indexing folder: " + error.message);
    }
  }

  getSpreadsheetHierarchy() {
    if (this.hierarchyCache.subdomains && (Date.now() - this.hierarchyCache.lastUpdate) < this.cacheExpiry) {
      return this.hierarchyCache.subdomains;
    }
    try {
      const folder = this.getIndexingFolder();
      const files = folder.getFiles();
      const hierarchy = {};
      this.HIERARCHY.subdomains.forEach(s => { hierarchy[s] = {}; });

      let totalFiles = 0;
      while (files.hasNext()) {
        const file = files.next();
        if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
          const parts = this.parseSpreadsheetName(file.getName());
          if (parts && hierarchy[parts.subdomain]) {
            if (!hierarchy[parts.subdomain][parts.language]) {
              hierarchy[parts.subdomain][parts.language] = { count: 0, fileIds: [] };
            }
            hierarchy[parts.subdomain][parts.language].count++;
            hierarchy[parts.subdomain][parts.language].fileIds.push(file.getId());
            totalFiles++;
          }
        }
      }
      this.hierarchyCache.subdomains = hierarchy;
      this.hierarchyCache.lastUpdate = Date.now();
      Logger.log("Hierarchy built: " + totalFiles + " spreadsheets");
      return hierarchy;
    } catch (error) {
      Logger.log("ERROR building hierarchy: " + error.message);
      throw error;
    }
  }

  getSpreadsheetsByHierarchy(subdomain, language) {
    const cacheKey = subdomain + "_" + language;
    if (this.hierarchyCache.spreadsheets.has(cacheKey)) {
      const cached = this.hierarchyCache.spreadsheets.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheExpiry) return cached.spreadsheets;
    }
    try {
      const hierarchy = this.getSpreadsheetHierarchy();
      const spreadsheets = [];
      if (hierarchy[subdomain] && hierarchy[subdomain][language]) {
        hierarchy[subdomain][language].fileIds.forEach(fileId => {
          try {
            const ss = SpreadsheetApp.openById(fileId);
            if (ss) spreadsheets.push(ss);
          } catch (e) {
            Logger.log("Could not open " + fileId + ": " + e.message);
          }
        });
      }
      this.hierarchyCache.spreadsheets.set(cacheKey, { spreadsheets, timestamp: Date.now() });
      Logger.log("Loaded " + spreadsheets.length + " spreadsheets for " + cacheKey);
      return spreadsheets;
    } catch (error) {
      Logger.log("ERROR fetching spreadsheets: " + error.message);
      throw error;
    }
  }

  /** Expected format: {subdomain}_{language}_indexing */
  parseSpreadsheetName(name) {
    if (!name || typeof name !== "string") return null;
    const parts = name.replace(/_indexing$/, "").split("_");
    if (parts.length === 2) return { subdomain: parts[0], language: parts[1] };
    if (parts.length === 1) return { subdomain: parts[0], language: "root" };
    return null;
  }

  getNextProcessingTarget(currentProgress) {
    currentProgress = currentProgress || {};
    const hierarchy = this.getSpreadsheetHierarchy();
    if (!currentProgress.subdomain) return this.findFirstAvailableTarget(hierarchy);

    let subdomainIndex = this.HIERARCHY.subdomains.indexOf(currentProgress.subdomain);
    let languageIndex = this.HIERARCHY.languages.indexOf(currentProgress.language);

    // Try next language in same subdomain
    for (let i = languageIndex + 1; i < this.HIERARCHY.languages.length; i++) {
      const lang = this.HIERARCHY.languages[i];
      if (this.hasSpreadsheets(hierarchy, currentProgress.subdomain, lang)) {
        return { subdomain: currentProgress.subdomain, language: lang };
      }
    }

    // Try next subdomain
    for (let i = subdomainIndex + 1; i < this.HIERARCHY.subdomains.length; i++) {
      const subdomain = this.HIERARCHY.subdomains[i];
      for (const language of this.HIERARCHY.languages) {
        if (this.hasSpreadsheets(hierarchy, subdomain, language)) return { subdomain, language };
      }
    }
    return null;
  }

  findFirstAvailableTarget(hierarchy) {
    for (const subdomain of this.HIERARCHY.subdomains) {
      for (const language of this.HIERARCHY.languages) {
        if (this.hasSpreadsheets(hierarchy, subdomain, language)) return { subdomain, language };
      }
    }
    return null;
  }

  hasSpreadsheets(hierarchy, subdomain, language) {
    return !!(hierarchy[subdomain] &&
              hierarchy[subdomain][language] &&
              hierarchy[subdomain][language].count > 0);
  }

  getProcessingStatistics() {
    const hierarchy = this.getSpreadsheetHierarchy();
    const stats = { totalSpreadsheets: 0, bySubdomain: {}, byLanguage: {}, combinations: [] };
    for (const [subdomain, languages] of Object.entries(hierarchy)) {
      stats.bySubdomain[subdomain] = 0;
      for (const [language, data] of Object.entries(languages)) {
        if (!stats.byLanguage[language]) stats.byLanguage[language] = 0;
        stats.totalSpreadsheets += data.count;
        stats.bySubdomain[subdomain] += data.count;
        stats.byLanguage[language] += data.count;
        if (data.count > 0) stats.combinations.push({ subdomain, language, count: data.count });
      }
    }
    stats.combinations.sort((a, b) => b.count - a.count);
    return stats;
  }

  clearAllCaches() {
    this.folderCache = null;
    this.hierarchyCache = { subdomains: null, spreadsheets: new Map() };
    Logger.log("All caches cleared");
  }
}
