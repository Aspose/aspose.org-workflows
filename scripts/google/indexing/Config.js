/**
 * @fileoverview Configuration for the URL indexing script.
 * All global constants and settings are defined here.
 */

const HEADER_ROW = ["Bing Status", "Yandex Status", "Naver Status", "Seznam Status", "Yep Status", "Google Status", "Fetch Date", "URL"];

const SUBMISSION_INTERVAL_DAYS = 14;

const INDEXNOW_ENDPOINTS = {
  "bing": "https://www.bing.com/indexnow",
  "yandex": "https://yandex.com/indexnow",
  "naver": "https://searchadvisor.naver.com/indexnow",
  "seznam": "https://search.seznam.cz/indexnow",
  "yep": "https://indexnow.yep.com/indexnow"
};

/**
 * IndexNow API key for aspose.org.
 * To set up: generate a key string, then deploy it as a text file at
 * https://{subdomain}.aspose.org/{key}.txt on all 7 subdomains
 * (products, docs, kb, reference, www, about, blog).
 * One key works for all IndexNow engines.
 */
const INDEXNOW_KEYS = {
  "bing": "REDACTED_INDEXNOW_KEY",
  "yandex": "REDACTED_INDEXNOW_KEY",
  "naver": "REDACTED_INDEXNOW_KEY",
  "seznam": "REDACTED_INDEXNOW_KEY",
  "yep": "REDACTED_INDEXNOW_KEY"
};

/**
 * Google service account for aspose.org.
 * Requirements:
 *   - Google Indexing API enabled in its GCP project
 *   - Owner-level access in Google Search Console for sc-domain:aspose.org
 * Provide: email address + private key from the JSON key file.
 */
const SERVICE_ACCOUNT_EMAIL = "REDACTED_SA_EMAIL";
const SERVICE_ACCOUNT_PRIVATE_KEY = "REDACTED_PRIVATE_KEY";

/**
 * Generates the list of aspose.org sitemaps.
 * Structure: subdomain + language (no family dimension).
 */
function getSitemapList() {
  Logger.log("Generating sitemap list for aspose.org...");

  const sitemaps = [];

  const subdomains = ["products.aspose.org", "kb.aspose.org", "reference.aspose.org", "docs.aspose.org"];
  const languages = [
    "en", "de", "es", "fr", "ja", "ko", "ru", "zh", "ar", "it", "pt", "pl", "fa", "id", "cs", "vi", "tr", "th", "sv", "el", "uk", "bg", "sr",
    "da", "fi", "he", "hi", "hu", "lv", "ms", "nl", "no", "lt", "ca", "hr", "ro", "sk"
  ];

  subdomains.forEach(subdomain => {
    languages.forEach(lang => {
      sitemaps.push({
        url: `https://${subdomain}/${lang}/sitemap.xml`,
        name: `${subdomain}/${lang}`,
        subdomain: subdomain,
        language: lang
      });
    });
  });

  // Root sitemaps (no language segmentation)
  ["www.aspose.org", "about.aspose.org", "blog.aspose.org"].forEach(site => {
    sitemaps.push({
      url: `https://${site}/sitemap.xml`,
      name: site,
      subdomain: site,
      language: 'root'
    });
  });

  Logger.log(`Generated ${sitemaps.length} sitemaps`);
  return sitemaps;
}

/**
 * Validates configuration
 */
function validateConfiguration() {
  Logger.log("=== CONFIGURATION VALIDATION ===");

  const validation = { valid: false, errors: [], warnings: [], components: {} };

  try {
    if (!Array.isArray(HEADER_ROW) || HEADER_ROW.length < 8) {
      validation.errors.push("HEADER_ROW is missing or too short");
    } else {
      validation.components.headerRow = { valid: true, columns: HEADER_ROW.length };
    }

    if (typeof SUBMISSION_INTERVAL_DAYS !== 'number' || SUBMISSION_INTERVAL_DAYS < 1) {
      validation.errors.push("SUBMISSION_INTERVAL_DAYS is invalid");
    } else {
      validation.components.submissionInterval = { valid: true, days: SUBMISSION_INTERVAL_DAYS };
    }

    if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_EMAIL.includes('@')) {
      validation.errors.push("SERVICE_ACCOUNT_EMAIL is missing or invalid");
    } else {
      validation.components.serviceAccountEmail = { valid: true };
    }

    if (!SERVICE_ACCOUNT_PRIVATE_KEY || !SERVICE_ACCOUNT_PRIVATE_KEY.includes('BEGIN PRIVATE KEY')) {
      validation.errors.push("SERVICE_ACCOUNT_PRIVATE_KEY is missing or invalid");
    } else {
      validation.components.serviceAccountKey = { valid: true };
    }

    try {
      const sitemaps = getSitemapList();
      validation.components.sitemaps = { valid: sitemaps.length > 0, count: sitemaps.length };
    } catch (e) {
      validation.errors.push(`getSitemapList() error: ${e.message}`);
    }

    validation.valid = validation.errors.length === 0;
    Logger.log(`Configuration validation: ${validation.valid ? 'PASSED' : 'FAILED'}`);
    if (validation.errors.length > 0) {
      validation.errors.forEach(e => Logger.log(`  ERROR: ${e}`));
    }

    return validation;

  } catch (error) {
    Logger.log(`Configuration validation failed: ${error.message}`);
    validation.errors.push(error.message);
    return validation;
  }
}
