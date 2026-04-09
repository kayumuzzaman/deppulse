import type {
  AnalysisResult,
  DependencyAnalysis,
  MaintenanceSignals,
  PerformanceMetrics,
} from '../types';

const MAX_VULNS_PER_DEP = 20;
const MAX_TRANSITIVE_CHILDREN = 50;

// Dashboard-specific data structures
export interface DashboardData {
  healthScore: {
    overall: number;
    security: number;
    freshness: number;
    compatibility: number;
    license: number;
  };
  metrics: DashboardMetrics;
  chartData: ChartData;
  dependencies: DependencyTableRow[];
  failedPackages?: Array<{
    name: string;
    version: string;
    error: string;
  }>;
  isMonorepo?: boolean;
  /**
   * Count of detected package.json files in the project
   */
  packageJsonCount?: number;
  /**
   * True when the project is a monolith with exactly one package.json
   */
  isSinglePackageMonolith?: boolean;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  lastScanned: Date;
  isCached: boolean;
  cacheAge?: number;
  cacheEnabled?: boolean;
  performanceMetrics?: PerformanceMetrics;
  networkStatus?: {
    isOnline: boolean;
    degradedFeatures: string[];
    message?: string;
  };
  transitiveEnabled?: boolean;
}

export interface TransitiveVulnSummary {
  totalVulnerabilities: number;
  totalAffectedTransitiveDeps: number;
  directPackagesWithTransitiveVulns: number;
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  affectedDirectPackages: Array<{
    packageName: string;
    rowKey: string;
    transitiveVulnCount: number;
    highestSeverity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  }>;
}

export interface DashboardMetrics {
  totalDependencies: number;
  analyzedDependencies: number;
  failedDependencies: number;
  criticalIssues: number;
  highIssues: number;
  outdatedPackages: number;
  healthyPackages: number;
  transitiveVulnSummary?: TransitiveVulnSummary;
}

export interface ChartData {
  severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    none: number;
  };
  freshness: {
    current: number;
    patch: number;
    minor: number;
    major: number;
    unmaintained: number;
  };
}

export interface DependencyTableRow {
  packageName: string;
  rowKey: string;
  workspaceFolder?: string;
  packageRoot?: string;
  cveIds: string[];
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  freshness: 'current' | 'patch' | 'minor' | 'major' | 'unmaintained';
  compatibility?: {
    status: 'safe' | 'breaking-changes' | 'version-deprecated' | 'unknown';
    issues: Array<{
      type: 'version-deprecated' | 'breaking-change' | 'version-conflict';
      severity: 'critical' | 'high' | 'medium' | 'low';
      message: string;
      recommendation?: string;
      migrationGuide?: string;
    }>;
    upgradeWarnings?: Array<{
      breakingChange: string;
      description: string;
      migrationGuide?: string;
    }>;
  };
  cvssScore: number | null;
  cvssVersion: string | null;
  vectorString: string | null;
  highestCvssScore: number | null;
  currentVersion: string;
  latestVersion: string;
  lastUpdated: Date;
  hasUpdate: boolean;
  repositoryUrl?: string | null;
  homepageUrl?: string | null;
  description?: string | null;
  vulnerabilities: Array<{
    id: string;
    severity: string;
    cvssScore?: number;
    cvssVersion?: string;
    vectorString?: string;
    source: 'osv' | 'github';
  }>;
  maintenanceSignals?: MaintenanceSignalsRow;
  /**
   * Whether to surface the Alternatives tab (replacement-only path)
   */
  alternativesEligible?: boolean;
  truncatedVulnCount?: number;
  truncatedTransitiveCount?: number;
  license?: {
    license: string;
    spdxId?: string;
    spdxIds: string[];
    isCompatible: boolean;
    licenseType: 'permissive' | 'copyleft' | 'proprietary' | 'unknown';
    riskLevel?: 'low' | 'medium' | 'high';
    compatibilityReason?: string;
    requiresAttribution?: boolean;
    requiresSourceCode?: boolean;
    conflictsWith?: string[];
  };
  children?: DependencyTableRow[];
}

export interface MaintenanceSignalsRow {
  isLongTermUnmaintained: boolean;
  reasons: Array<{
    source: 'npm' | 'github' | 'readme';
    label: string;
    details?: string;
  }>;
}

/**
 * Transforms analysis results into dashboard-ready data structures
 */
export class DashboardDataTransformer {
  private log: (message: string) => void;

  constructor(log: (message: string) => void) {
    this.log = log;
  }

  /**
   * Transform AnalysisResult to DashboardData
   * @param analysis The analysis results to transform
   * @returns Dashboard data structure
   */
  public transformAnalysisData(
    analysis: AnalysisResult,
    options?: { transitiveEnabled?: boolean }
  ): DashboardData {
    const transitiveEnabled = options?.transitiveEnabled ?? true;
    // Include ALL dependencies in the dashboard - only exclude packages explicitly marked as failed
    // isFailed === true means the package doesn't exist in NPM registry (fake/invalid package)
    // isFailed === false or undefined means it's a real package (even if analysis had errors)
    const realDependencies = analysis.dependencies.filter(
      (d) => d.isFailed !== true && !d.dependency.isInternal
    );
    const failedDependencies = analysis.dependencies.filter(
      (d) => d.isFailed === true && !d.dependency.isInternal
    );

    const workspaceKeys = new Set(
      realDependencies
        .map((d) => d.dependency.workspaceFolder || d.dependency.packageRoot)
        .filter(Boolean)
    );
    const packageJsonCount =
      typeof analysis.packageJsonCount === 'number'
        ? analysis.packageJsonCount
        : workspaceKeys.size;
    const isMonorepo =
      typeof analysis.isMonorepo === 'boolean' ? analysis.isMonorepo : workspaceKeys.size > 1;
    const isSinglePackageMonolith = !isMonorepo && packageJsonCount === 1;

    // Log detailed information for debugging
    this.log(
      `Transforming analysis data: ${analysis.dependencies.length} total deps in analysis result`
    );
    const failedCount = analysis.dependencies.filter((d) => d.isFailed === true).length;
    const undefinedCount = analysis.dependencies.filter((d) => d.isFailed === undefined).length;
    const falseCount = analysis.dependencies.filter((d) => d.isFailed === false).length;
    this.log(
      `isFailed breakdown: true=${failedCount} (excluded), false=${falseCount}, undefined=${undefinedCount}, real=${realDependencies.length}`
    );

    // Log all dependency names for debugging
    const allDepNames = analysis.dependencies.map((d) => d.dependency.name);
    const realDepNames = realDependencies.map((d) => d.dependency.name);
    const failedDepNames = analysis.dependencies
      .filter((d) => d.isFailed === true)
      .map((d) => d.dependency.name);
    this.log(`All dependencies (${allDepNames.length}): ${allDepNames.join(', ')}`);
    this.log(`Real dependencies (${realDepNames.length}): ${realDepNames.join(', ')}`);
    if (failedDepNames.length > 0) {
      this.log(`Failed dependencies (${failedDepNames.length}): ${failedDepNames.join(', ')}`);
    }

    this.log(
      `Transforming analysis data: ${analysis.dependencies.length} total deps, ${realDependencies.length} real deps, ${analysis.dependencies.length - realDependencies.length} failed`
    );
    this.log(
      `Real dependencies sample (first 3): ${JSON.stringify(realDependencies.slice(0, 3).map((d) => ({ name: d.dependency.name, isFailed: d.isFailed })))}`
    );

    // Calculate metrics (only for real packages)
    const metrics: DashboardMetrics = {
      totalDependencies: analysis.summary.totalDependencies,
      analyzedDependencies: analysis.summary.analyzedDependencies,
      failedDependencies: analysis.summary.failedDependencies,
      criticalIssues: realDependencies.filter((dep) => dep.security.severity === 'critical').length,
      highIssues: realDependencies.filter((dep) => dep.security.severity === 'high').length,
      outdatedPackages: realDependencies.filter((dep) => dep.freshness.isOutdated).length,
      healthyPackages: analysis.summary.healthy,
    };

    // Calculate chart data for severity (only real packages)
    const severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      none: 0,
    };

    realDependencies.forEach((dep) => {
      const severity = dep.security.severity;
      severityCounts[severity]++;
    });

    // Calculate chart data for freshness (only real packages)
    const freshnessCounts = {
      current: 0,
      patch: 0,
      minor: 0,
      major: 0,
      unmaintained: 0,
    };

    realDependencies.forEach((dep) => {
      if (dep.freshness.isUnmaintained) {
        freshnessCounts.unmaintained++;
      } else {
        const gap = dep.freshness.versionGap;
        freshnessCounts[gap]++;
      }
    });

    // Transform dependencies to table rows (only real packages shown in main table)
    // CRITICAL: Include ALL dependencies that are not explicitly marked as failed
    // This ensures we show all real packages, even if some analysis steps had errors
    const dependencies: DependencyTableRow[] = [
      ...realDependencies.map((dep) => this.transformDependencyToTableRow(dep, transitiveEnabled)),
      // Preserve failed dependencies to avoid data loss in property-based tests and dashboard state
      ...failedDependencies.map((dep) => ({
        packageName: dep.dependency.name || 'unknown',
        rowKey: dep.dependency.name || 'unknown',
        workspaceFolder: dep.dependency.workspaceFolder,
        packageRoot: dep.dependency.packageRoot,
        cveIds: [] as string[],
        severity: 'none' as const,
        freshness: 'current' as const,
        compatibility: undefined,
        cvssScore: null as number | null,
        cvssVersion: null as string | null,
        vectorString: null as string | null,
        highestCvssScore: null as number | null,
        currentVersion: dep.dependency.version ?? 'unknown',
        latestVersion: dep.dependency.version ?? 'unknown',
        lastUpdated: dep.freshness?.releaseDate ? new Date(dep.freshness.releaseDate) : new Date(0),
        hasUpdate: false,
        repositoryUrl: null,
        homepageUrl: null,
        description: null,
        vulnerabilities: [] as {
          id: string;
          severity: string;
          cvssScore?: number | undefined;
          cvssVersion?: string | undefined;
          vectorString?: string | undefined;
          source: 'osv' | 'github';
        }[],
        maintenanceSignals: dep.maintenanceSignals
          ? {
              isLongTermUnmaintained: dep.maintenanceSignals.isLongTermUnmaintained ?? false,
              reasons: [],
            }
          : undefined,
        alternativesEligible: false,
        truncatedVulnCount: 0,
        truncatedTransitiveCount: 0,
        license: dep.license
          ? {
              license: dep.license.license ?? 'Unknown',
              spdxId: dep.license.spdxIds?.[0],
              spdxIds: dep.license.spdxIds ?? [],
              isCompatible: dep.license.isCompatible ?? false,
              licenseType: dep.license.licenseType ?? 'unknown',
            }
          : {
              license: 'Unknown',
              spdxIds: [],
              isCompatible: false,
              licenseType: 'unknown' as const,
            },
      })),
    ];

    // Validation: Ensure we're not losing dependencies
    if (dependencies.length !== realDependencies.length) {
      this.log(
        `WARNING: Dependency count mismatch! realDependencies=${realDependencies.length}, transformed=${dependencies.length}`
      );
    }

    // Final validation: Check against summary
    if (dependencies.length < analysis.summary.analyzedDependencies) {
      this.log(
        `WARNING: Dashboard showing fewer dependencies (${dependencies.length}) than analyzed (${analysis.summary.analyzedDependencies}). This may indicate a filtering bug.`
      );
    }

    this.log(`Transformed ${dependencies.length} dependencies to table rows`);

    // Count total dependencies including transitive
    const countTotal = (deps: DependencyTableRow[]): number => {
      return deps.reduce((acc, dep) => {
        return acc + 1 + (transitiveEnabled && dep.children ? countTotal(dep.children) : 0);
      }, 0);
    };
    const totalTransformed = countTotal(dependencies);
    this.log(
      `Total dependencies in dashboard data (${
        transitiveEnabled ? 'including' : 'excluding'
      } transitive): ${totalTransformed}`
    );

    this.log(`Sample table row: ${JSON.stringify(dependencies[0] || {})}`);

    // Compute transitive vulnerability summary for dashboard-level awareness
    if (transitiveEnabled) {
      const transitiveVulnSummary = this.computeTransitiveVulnSummary(dependencies);
      metrics.transitiveVulnSummary = transitiveVulnSummary;
      if (transitiveVulnSummary.totalVulnerabilities > 0) {
        this.log(
          `Transitive vulnerabilities: ${transitiveVulnSummary.totalVulnerabilities} vulns across ${transitiveVulnSummary.totalAffectedTransitiveDeps} transitive deps in ${transitiveVulnSummary.directPackagesWithTransitiveVulns} direct packages`
        );
      }
    }

    return {
      healthScore: {
        overall: Math.round(analysis.healthScore.overall),
        security: Math.round(analysis.healthScore.security),
        freshness: Math.round(analysis.healthScore.freshness),
        compatibility: Math.round(analysis.healthScore.compatibility),
        license: Math.round(analysis.healthScore.license),
      },
      isMonorepo,
      packageJsonCount,
      isSinglePackageMonolith,
      metrics,
      chartData: {
        severity: severityCounts,
        freshness: freshnessCounts,
      },
      dependencies,
      failedPackages: analysis.failedPackages?.map((fp) => ({
        name: fp.name,
        version: fp.version,
        error: fp.error,
      })),
      packageManager: 'npm', // Will be detected dynamically
      lastScanned: analysis.timestamp,
      isCached: false, // Will be determined by cache manager
      cacheAge: undefined,
      performanceMetrics: transitiveEnabled
        ? analysis.performanceMetrics
        : analysis.performanceMetrics
          ? {
              ...analysis.performanceMetrics,
              transitiveDependencyCount: 0,
            }
          : analysis.performanceMetrics,
      networkStatus: analysis.networkStatus
        ? {
            isOnline: analysis.networkStatus.isOnline,
            degradedFeatures: analysis.networkStatus.degradedFeatures,
            message: this.buildNetworkStatusMessage(analysis.networkStatus),
          }
        : undefined,
      transitiveEnabled,
    };
  }

  /**
   * Transform a single DependencyAnalysis to DependencyTableRow
   * @param dep The dependency analysis
   * @returns Table row data
   */
  public transformDependencyToTableRow(
    dep: DependencyAnalysis,
    transitiveEnabled: boolean = true
  ): DependencyTableRow {
    // Extract vulnerability IDs (CVE, GHSA, etc.) from vulnerabilities
    const cveIds = dep.security.vulnerabilities.map((vuln) => vuln.id);
    const workspaceFolder = dep.dependency.workspaceFolder;
    const packageRoot = dep.dependency.packageRoot;
    const scopeKey = packageRoot || workspaceFolder;
    const rowKey = scopeKey ? `${dep.dependency.name}::${scopeKey}` : dep.dependency.name;

    // Get highest CVSS score and its associated data
    let highestCvssScore: number | null = null;
    let cvssVersion: string | null = null;
    let vectorString: string | null = null;

    if (dep.security.vulnerabilities.length > 0) {
      // Find vulnerability with highest CVSS score
      const highestVuln = dep.security.vulnerabilities.reduce((prev, curr) => {
        const prevScore = prev.cvssScore || 0;
        const currScore = curr.cvssScore || 0;
        return currScore > prevScore ? curr : prev;
      });

      highestCvssScore = highestVuln.cvssScore || null;
      cvssVersion = highestVuln.cvssVersion || null;
      vectorString = highestVuln.vectorString || null;
    }

    // Transform vulnerabilities with source information
    const vulnerabilities = dep.security.vulnerabilities
      .slice(0, MAX_VULNS_PER_DEP)
      .map((vuln) => ({
        id: vuln.id,
        severity: vuln.severity,
        cvssScore: vuln.cvssScore,
        cvssVersion: vuln.cvssVersion,
        vectorString: vuln.vectorString,
        source: (vuln.sources && vuln.sources.length > 0 ? vuln.sources[0] : 'github') as
          | 'osv'
          | 'github',
      }));
    const truncatedVulnCount =
      dep.security.vulnerabilities.length > MAX_VULNS_PER_DEP
        ? dep.security.vulnerabilities.length - MAX_VULNS_PER_DEP
        : 0;

    // Determine freshness category
    let freshness: 'current' | 'patch' | 'minor' | 'major' | 'unmaintained';
    if (dep.freshness.isUnmaintained) {
      freshness = 'unmaintained';
    } else {
      freshness = dep.freshness.versionGap as 'current' | 'patch' | 'minor' | 'major';
    }

    // Recursively transform children if they exist (cap to avoid huge payloads)
    const truncatedTransitiveCount =
      transitiveEnabled && dep.children && dep.children.length > MAX_TRANSITIVE_CHILDREN
        ? dep.children.length - MAX_TRANSITIVE_CHILDREN
        : 0;
    const children =
      transitiveEnabled && dep.children
        ? dep.children
            .slice(0, MAX_TRANSITIVE_CHILDREN)
            .map((child) => this.transformDependencyToTableRow(child, transitiveEnabled))
        : undefined;

    const alternativesEligible = this.computeAlternativesEligibility(dep);

    // Transform compatibility data if available
    const compatibility = dep.compatibility
      ? {
          status: dep.compatibility.status,
          issues: dep.compatibility.issues.map((issue) => ({
            type: issue.type,
            severity: issue.severity,
            message: issue.message,
            recommendation: issue.recommendation,
            migrationGuide: issue.migrationGuide,
          })),
          upgradeWarnings: dep.compatibility.upgradeWarnings?.map((warning) => ({
            breakingChange: warning.breakingChange,
            description: warning.description,
            migrationGuide: warning.migrationGuide,
          })),
        }
      : undefined;

    return {
      packageName: dep.dependency.name,
      rowKey,
      workspaceFolder: workspaceFolder ?? undefined,
      packageRoot: packageRoot ?? undefined,
      cveIds,
      severity: dep.security.severity,
      freshness,
      compatibility,
      cvssScore: highestCvssScore,
      cvssVersion,
      vectorString,
      highestCvssScore,
      currentVersion: dep.dependency.version,
      latestVersion: dep.freshness.latestVersion,
      lastUpdated: dep.freshness.releaseDate,
      hasUpdate: dep.freshness.isOutdated,
      repositoryUrl: dep.packageInfo?.repository ?? null,
      homepageUrl: dep.packageInfo?.homepage ?? null,
      description: dep.packageInfo?.description
        ? this.truncate(dep.packageInfo.description, 300)
        : null,
      vulnerabilities,
      truncatedVulnCount: truncatedVulnCount || undefined,
      maintenanceSignals: this.buildMaintenanceSignalsRow(
        dep.maintenanceSignals ?? dep.freshness.maintenanceSignals
      ),
      alternativesEligible,
      truncatedTransitiveCount: transitiveEnabled
        ? truncatedTransitiveCount || undefined
        : undefined,
      license: {
        license: dep.license.license,
        spdxId: dep.license.spdxId,
        spdxIds: dep.license.spdxIds || [],
        isCompatible: dep.license.isCompatible,
        licenseType: dep.license.licenseType,
        riskLevel: dep.license.riskLevel,
        compatibilityReason: dep.license.compatibilityReason,
        requiresAttribution: dep.license.requiresAttribution,
        requiresSourceCode: dep.license.requiresSourceCode,
        conflictsWith: dep.license.conflictsWith,
      },
      children,
    };
  }

  /**
   * Walk all dependency trees to aggregate transitive vulnerability data.
   * Returns a summary that the dashboard can render as a top-level alert.
   */
  private computeTransitiveVulnSummary(dependencies: DependencyTableRow[]): TransitiveVulnSummary {
    const severityOrder: Record<string, number> = {
      critical: 4,
      high: 3,
      medium: 2,
      low: 1,
      none: 0,
    };

    const summary: TransitiveVulnSummary = {
      totalVulnerabilities: 0,
      totalAffectedTransitiveDeps: 0,
      directPackagesWithTransitiveVulns: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      affectedDirectPackages: [],
    };

    for (const dep of dependencies) {
      if (!dep.children || dep.children.length === 0) continue;

      let depTransitiveVulnCount = 0;
      let highestSev = 'none';

      const walkChildren = (nodes: DependencyTableRow[]) => {
        for (const child of nodes) {
          if (child.cveIds && child.cveIds.length > 0) {
            depTransitiveVulnCount += child.cveIds.length;
            summary.totalAffectedTransitiveDeps++;
            const sev = child.severity || 'low';
            if (sev in summary.bySeverity) {
              summary.bySeverity[sev as keyof typeof summary.bySeverity]++;
            }
            if ((severityOrder[sev] ?? 0) > (severityOrder[highestSev] ?? 0)) {
              highestSev = sev;
            }
          }
          if (child.children) walkChildren(child.children);
        }
      };

      walkChildren(dep.children);

      if (depTransitiveVulnCount > 0) {
        summary.totalVulnerabilities += depTransitiveVulnCount;
        summary.directPackagesWithTransitiveVulns++;
        summary.affectedDirectPackages.push({
          packageName: dep.packageName,
          rowKey: dep.rowKey,
          transitiveVulnCount: depTransitiveVulnCount,
          highestSeverity: highestSev as 'critical' | 'high' | 'medium' | 'low' | 'none',
        });
      }
    }

    // Sort affected packages by severity then count (most severe first)
    summary.affectedDirectPackages.sort((a, b) => {
      const sevDiff =
        (severityOrder[b.highestSeverity] ?? 0) - (severityOrder[a.highestSeverity] ?? 0);
      return sevDiff !== 0 ? sevDiff : b.transitiveVulnCount - a.transitiveVulnCount;
    });

    return summary;
  }

  /**
   * Decide whether Alternatives should be shown.
   * We show it only when a replacement is likely the right path (unmaintained/deprecated without upgrade).
   * Priority: Upgrade path > Alternatives (if user can upgrade, don't suggest alternatives).
   */
  private computeAlternativesEligibility(dep: DependencyAnalysis): boolean {
    const maintenance = dep.maintenanceSignals ?? dep.freshness.maintenanceSignals;
    const reasons = maintenance?.reasons ?? [];

    const hasPackageDeprecation = reasons.some(
      (reason) => reason.source === 'npm' && reason.type === 'deprecated'
    );
    const hasVersionDeprecation = reasons.some(
      (reason) => reason.source === 'npm' && reason.type === 'version-deprecated'
    );
    const hasArchivedRepo = reasons.some(
      (reason) => reason.source === 'github' && reason.type === 'archived'
    );
    const hasReadmeNotice = reasons.some((reason) => reason.source === 'readme');

    const hasUpgradePath = !!dep.freshness.latestVersion && dep.freshness.versionGap !== 'current';
    const isUnmaintained = dep.freshness.isUnmaintained || maintenance?.isLongTermUnmaintained;

    // Package-level deprecation: always show (no supported upgrade path)
    if (hasPackageDeprecation) {
      return true;
    }

    // Check upgrade path first - if exists, don't show alternatives
    // Only show alternatives if NO upgrade path exists:
    //    - Unmaintained + no upgrade path
    //    - Archived repo + no upgrade path
    //    - README notice + no upgrade path
    //    - Version deprecation + no upgrade path
    if (!hasUpgradePath) {
      if (isUnmaintained || hasArchivedRepo || hasReadmeNotice || hasVersionDeprecation) {
        return true;
      }
    }

    return false;
  }

  /**
   * Build maintenance signals row from MaintenanceSignals
   * @param signals Maintenance signals data
   * @returns Formatted maintenance signals row
   */
  public buildMaintenanceSignalsRow(
    signals?: MaintenanceSignals
  ): MaintenanceSignalsRow | undefined {
    if (!signals) {
      return undefined;
    }

    return {
      isLongTermUnmaintained: signals.isLongTermUnmaintained,
      reasons: signals.reasons.slice(0, 3).map((reason) => {
        switch (reason.source) {
          case 'npm':
            // Distinguish between version-specific and package-level deprecation
            if (reason.type === 'version-deprecated') {
              return {
                source: 'npm' as const,
                label: 'Version deprecated',
                details: reason.message ? this.truncate(reason.message) : undefined,
              };
            }
            return {
              source: 'npm' as const,
              label: 'Package deprecated',
              details: reason.message ? this.truncate(reason.message) : undefined,
            };
          case 'github':
            return {
              source: 'github' as const,
              label: 'GitHub repository archived',
              details: reason.repository,
            };
          default:
            return {
              source: 'readme' as const,
              label: 'Maintenance notice',
              details: reason.excerpt ? this.truncate(reason.excerpt) : undefined,
            };
        }
      }),
    };
  }

  /**
   * Truncate text to maximum length
   * @param text Text to truncate
   * @param maxLength Maximum length (default: 180)
   * @returns Truncated text
   */
  public truncate(text: string, maxLength = 180): string {
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }

  /**
   * Build a user-friendly network status message
   * @param networkStatus The network status from analysis
   * @returns Human-readable message describing network issues
   */
  private buildNetworkStatusMessage(networkStatus: {
    isOnline: boolean;
    degradedFeatures: string[];
    errors: string[];
  }): string {
    if (networkStatus.errors && networkStatus.errors.length > 0) {
      return networkStatus.errors[0];
    }

    if (networkStatus.isOnline && networkStatus.degradedFeatures.length === 0) {
      return '';
    }

    const featureNames: Record<string, string> = {
      'vulnerability-scan': 'Vulnerability scanning',
      'version-check': 'Version checking',
      'npm-registry': 'NPM registry',
      'github-advisory': 'GitHub Advisory',
      osv: 'OSV vulnerability database',
    };

    const features = networkStatus.degradedFeatures;
    const readableFeatures = features.map((f) => featureNames[f] || f);

    if (readableFeatures.length === 0) {
      return 'Unable to reach external services. Showing cached data where available.';
    }

    if (readableFeatures.length === 1) {
      return `${readableFeatures[0]} is unavailable due to network issues. Showing cached data where available.`;
    }

    const lastFeature = readableFeatures.pop();
    return `${readableFeatures.join(', ')} and ${lastFeature} are unavailable due to network issues. Showing cached data where available.`;
  }
}
