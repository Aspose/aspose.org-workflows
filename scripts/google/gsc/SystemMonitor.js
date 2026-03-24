/**
 * @fileoverview Comprehensive monitoring and reporting module for hierarchical system
 * 
 * This module provides detailed monitoring, reporting, and diagnostic capabilities
 * for the hierarchical indexing system. It includes performance tracking, health
 * checks, and progress visualization.
 * 
 * @version 2.0.0
 * @requires SpreadsheetManagerV2
 * @requires IndexingOrchestrator
 * @requires SitemapCollectorV2
 */

class SystemMonitor {
  constructor() {
    this.props = PropertiesService.getScriptProperties();
    this.spreadsheetManager = new SpreadsheetManagerV2();
  }

  /**
   * Generate comprehensive system report
   */
  generateSystemReport() {
    Logger.log("=== COMPREHENSIVE SYSTEM REPORT ===");
    Logger.log(`Generated: ${new Date().toLocaleString()}`);
    
    const report = {
      overview: this.getSystemOverview(),
      collection: this.getCollectionMetrics(),
      indexing: this.getIndexingMetrics(),
      performance: this.getPerformanceMetrics(),
      health: this.getHealthStatus(),
      recommendations: this.generateRecommendations()
    };
    
    this.logReport(report);
    return report;
  }

  /**
   * Get system overview
   */
  getSystemOverview() {
    const stats = this.spreadsheetManager.getProcessingStatistics();
    const hierarchy = this.spreadsheetManager.getSpreadsheetHierarchy();
    
    // Count active combinations
    let activeCombinations = 0;
    let totalUrls = 0;
    
    for (const subdomain in hierarchy) {
      for (const language in hierarchy[subdomain]) {
        if (hierarchy[subdomain][language] && hierarchy[subdomain][language].count > 0) {
          activeCombinations++;
        }
      }
    }
    
    return {
      totalSpreadsheets: stats.totalSpreadsheets,
      activeCombinations: activeCombinations,
      topSubdomains: Object.entries(stats.bySubdomain)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3),
      topLanguages: Object.entries(stats.byLanguage)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5),
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Get collection metrics
   */
  getCollectionMetrics() {
    const collector = new SitemapCollectorV2();
    const status = collector.getCollectionStatus();
    const lastComplete = this.props.getProperty('last_collection_complete');
    const lastRun = this.props.getProperty('last_sitemap_run');
    
    return {
      status: status.isComplete ? 'COMPLETE' : 'IN_PROGRESS',
      progress: {
        total: status.totalSitemaps,
        processed: status.processedSitemaps,
        percent: parseFloat(status.percentComplete)
      },
      lastComplete: lastComplete || 'Never',
      lastRun: lastRun || 'Never',
      estimatedCompletion: this.estimateCompletion('collection', status)
    };
  }

  /**
   * Get indexing metrics
   */
  getIndexingMetrics() {
    const indexNowProgress = this.props.getProperty('indexnow_hierarchical_progress');
    const googleProgress = this.props.getProperty('google_hierarchical_progress');
    const googleSubmissions = parseInt(this.props.getProperty('google_submissions_today') || '0', 10);
    
    return {
      indexNow: {
        status: indexNowProgress ? 'IN_PROGRESS' : 'IDLE',
        currentTarget: indexNowProgress ? JSON.parse(indexNowProgress) : null,
        lastComplete: this.props.getProperty('last_indexnow_complete') || 'Never'
      },
      google: {
        status: googleProgress ? 'IN_PROGRESS' : 'IDLE',
        currentTarget: googleProgress ? JSON.parse(googleProgress) : null,
        lastComplete: this.props.getProperty('last_google_complete') || 'Never',
        dailyUsage: {
          submitted: googleSubmissions,
          limit: 200,
          percent: (googleSubmissions / 200 * 100).toFixed(1)
        }
      }
    };
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    const metrics = [];
    const functions = ['collectAllURLs', 'indexIndexNow', 'indexGoogle'];
    
    functions.forEach(func => {
      const key = `metrics_${func}_${getShortDate()}`;
      const data = this.props.getProperty(key);
      
      if (data) {
        try {
          const parsed = JSON.parse(data);
          metrics.push({
            function: func,
            ...parsed
          });
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
    
    return {
      today: metrics,
      averageExecutionTime: metrics.length > 0 ?
        (metrics.reduce((sum, m) => sum + m.duration, 0) / metrics.length).toFixed(2) : 0,
      totalUrlsProcessed: metrics.reduce((sum, m) => sum + (m.totalCount || 0), 0)
    };
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    const issues = [];
    const warnings = [];
    
    // Check triggers
    const triggers = ScriptApp.getProjectTriggers();
    const expectedFunctions = ['collectAllURLs', 'indexIndexNow', 'indexGoogle'];
    const activeFunctions = triggers.map(t => t.getHandlerFunction());
    
    expectedFunctions.forEach(func => {
      if (!activeFunctions.includes(func)) {
        issues.push(`Missing trigger for ${func}`);
      }
    });
    
    // Check API credentials
    try {
      const indexingAPI = new IndexingAPI();
      const token = indexingAPI.getServiceAccountToken();
      if (!token) {
        issues.push("Google API authentication failed");
      }
    } catch (e) {
      issues.push(`API check failed: ${e.message}`);
    }
    
    // Check folder access
    try {
      const folder = this.spreadsheetManager.getIndexingFolder();
      if (!folder) {
        issues.push("Cannot access indexing folder");
      }
    } catch (e) {
      issues.push(`Folder access failed: ${e.message}`);
    }
    
    // Check for stale progress
    const indexNowProgress = this.props.getProperty('indexnow_hierarchical_progress');
    if (indexNowProgress) {
      const progress = JSON.parse(indexNowProgress);
      if (progress.spreadsheetIndex > 10) {
        warnings.push("IndexNow appears stuck on same target");
      }
    }
    
    return {
      status: issues.length === 0 ? (warnings.length === 0 ? 'HEALTHY' : 'WARNING') : 'CRITICAL',
      issues: issues,
      warnings: warnings,
      lastCheck: new Date().toISOString()
    };
  }

  /**
   * Generate recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    const health = this.getHealthStatus();
    const indexing = this.getIndexingMetrics();
    
    // Health-based recommendations
    if (health.issues.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        message: 'Critical issues detected - run setupCompleteAutomation() to fix'
      });
    }
    
    // Google quota recommendations
    if (indexing.google.dailyUsage.submitted >= 180) {
      recommendations.push({
        priority: 'MEDIUM',
        message: 'Approaching Google daily limit - consider spreading submissions'
      });
    }
    
    // Progress recommendations
    if (indexing.indexNow.status === 'IN_PROGRESS' && 
        indexing.indexNow.currentTarget && 
        indexing.indexNow.currentTarget.spreadsheetIndex > 10) {
      recommendations.push({
        priority: 'MEDIUM',
        message: 'Consider resetting IndexNow progress if stuck'
      });
    }
    
    return recommendations;
  }

  /**
   * Estimate completion time
   */
  estimateCompletion(type, status) {
    if (type === 'collection') {
      const remaining = status.totalSitemaps - status.processedSitemaps;
      const perRun = 10; // MAX_SITEMAPS_PER_RUN
      const runsNeeded = Math.ceil(remaining / perRun);
      const hoursNeeded = runsNeeded; // Assuming hourly triggers
      
      return {
        runsRemaining: runsNeeded,
        estimatedHours: hoursNeeded,
        estimatedCompletion: hoursNeeded > 0 ? 
          new Date(Date.now() + hoursNeeded * 3600000).toISOString() : 'Complete'
      };
    }
    
    return null;
  }

  /**
   * Log formatted report
   */
  logReport(report) {
    Logger.log("\n📊 SYSTEM OVERVIEW");
    Logger.log(`   Total Spreadsheets: ${report.overview.totalSpreadsheets}`);
    Logger.log(`   Active Combinations: ${report.overview.activeCombinations}`);
    
    Logger.log("\n📦 COLLECTION STATUS");
    Logger.log(`   Status: ${report.collection.status}`);
    Logger.log(`   Progress: ${report.collection.progress.percent}%`);
    Logger.log(`   Last Complete: ${report.collection.lastComplete}`);
    
    Logger.log("\n🔄 INDEXING STATUS");
    Logger.log(`   IndexNow: ${report.indexing.indexNow.status}`);
    if (report.indexing.indexNow.currentTarget) {
      const t = report.indexing.indexNow.currentTarget;
      Logger.log(`     Current: ${t.subdomain}/${t.language}`);
    }
    Logger.log(`   Google: ${report.indexing.google.status}`);
    Logger.log(`     Daily Usage: ${report.indexing.google.dailyUsage.percent}%`);
    
    Logger.log("\n❤️ HEALTH STATUS");
    Logger.log(`   Status: ${report.health.status}`);
    if (report.health.issues.length > 0) {
      Logger.log("   Issues:");
      report.health.issues.forEach(issue => Logger.log(`     - ${issue}`));
    }
    
    if (report.recommendations.length > 0) {
      Logger.log("\n💡 RECOMMENDATIONS");
      report.recommendations.forEach(rec => {
        Logger.log(`   [${rec.priority}] ${rec.message}`);
      });
    }
  }
}

/**
 * Public monitoring functions
 */

function getSystemStatus() {
  const monitor = new SystemMonitor();
  return monitor.generateSystemReport();
}

function checkSystemHealth() {
  const monitor = new SystemMonitor();
  const health = monitor.getHealthStatus();
  
  Logger.log(`System Health: ${health.status}`);
  
  if (health.issues.length > 0) {
    Logger.log("Issues found:");
    health.issues.forEach(issue => Logger.log(`  - ${issue}`));
  }
  
  if (health.warnings.length > 0) {
    Logger.log("Warnings:");
    health.warnings.forEach(warning => Logger.log(`  - ${warning}`));
  }
  
  return health;
}

function getProcessingProgress() {
  const monitor = new SystemMonitor();
  const collection = monitor.getCollectionMetrics();
  const indexing = monitor.getIndexingMetrics();
  
  Logger.log("=== PROCESSING PROGRESS ===");
  
  Logger.log("\nCollection:");
  Logger.log(`  ${collection.progress.percent}% complete`);
  Logger.log(`  ${collection.progress.processed}/${collection.progress.total} sitemaps`);
  
  Logger.log("\nIndexNow:");
  if (indexing.indexNow.currentTarget) {
    const t = indexing.indexNow.currentTarget;
    Logger.log(`  Processing: ${t.subdomain}/${t.language}`);
  } else {
    Logger.log(`  Status: ${indexing.indexNow.status}`);
  }
  
  Logger.log("\nGoogle:");
  if (indexing.google.currentTarget) {
    const t = indexing.google.currentTarget;
    Logger.log(`  Processing: ${t.subdomain}/en`);
  } else {
    Logger.log(`  Status: ${indexing.google.status}`);
  }
  Logger.log(`  Daily usage: ${indexing.google.dailyUsage.submitted}/200`);
  
  return { collection, indexing };
}
