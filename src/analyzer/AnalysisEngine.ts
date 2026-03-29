import * as path from 'node:path';
import * as vscode from 'vscode';
import { getProjectLicense, loadLicenseConfig } from '../config/LicenseConfig';
import type {
  AnalysisResult,
  AnalysisStatus,
  AnalysisSummary,
  ClassificationCategory,
  Dependency,
  DependencyAnalysis,
  DependencyClassification,
  DependencyIssue,
  AnalysisEngine as IAnalysisEngine,
  LicenseAnalysis,
  PackageRegistryClient,
  ProjectInfo,
  SecurityAnalysis,
} from '../types';
import { DepPulseError, ErrorCode } from '../types';
import type { CacheManager } from '../utils';
import { NetworkStatusService } from '../utils/NetworkStatusService';
import type { CompatibilityAnalyzer } from './CompatibilityAnalyzer';
import type { FreshnessAnalyzer } from './FreshnessAnalyzer';
import { HealthScoreCalculator } from './HealthScoreCalculator';
import { LicenseAnalyzer } from './LicenseAnalyzer';
import { LicenseCompatibilityChecker } from './LicenseCompatibilityChecker';
import type { SecurityAnalyzer } from './SecurityAnalyzer';

/**
 * Coordinates analysis across multiple dimensions (security, freshness, etc.)
 * Aggregates results from various analyzers and manages analysis lifecycle
 */
export class AnalysisEngine implements IAnalysisEngine {
  private securityAnalyzer: SecurityAnalyzer;
  private freshnessAnalyzer: FreshnessAnalyzer;
  private compatibilityAnalyzer?: CompatibilityAnalyzer;
  private registryClient: PackageRegistryClient;
  private healthScoreCalculator: HealthScoreCalculator;
  private licenseAnalyzer: LicenseAnalyzer;
  private licenseCompatibilityChecker: LicenseCompatibilityChecker;
  private outputChannel: vscode.OutputChannel;
  private status: AnalysisStatus;
  private context: vscode.ExtensionContext;
  private chunkSize: number;
  private cacheManager?: CacheManager;
  private currentAnalysisCacheHits: number = 0;
  private licenseContextCache = new Map<
    string,
    Promise<{
      licenseConfig: ReturnType<typeof loadLicenseConfig>;
      projectLicense: string | undefined;
      workspaceFolder?: vscode.WorkspaceFolder;
    }>
  >();
  constructor(
    securityAnalyzer: SecurityAnalyzer,
    freshnessAnalyzer: FreshnessAnalyzer,
    registryClient: PackageRegistryClient,
    outputChannel: vscode.OutputChannel,
    context: vscode.ExtensionContext,
    chunkSize: number = 50,
    cacheManager?: CacheManager,
    compatibilityAnalyzer?: CompatibilityAnalyzer
  ) {
    this.securityAnalyzer = securityAnalyzer;
    this.freshnessAnalyzer = freshnessAnalyzer;
    this.compatibilityAnalyzer = compatibilityAnalyzer;
    this.registryClient = registryClient;
    this.healthScoreCalculator = new HealthScoreCalculator(outputChannel);
    this.licenseAnalyzer = new LicenseAnalyzer();
    this.licenseCompatibilityChecker = new LicenseCompatibilityChecker();
    this.outputChannel = outputChannel;
    this.context = context;
    this.chunkSize = chunkSize;
    this.cacheManager = cacheManager;
    this.status = {
      isRunning: false,
      progress: 0,
    };
  }

  /**
   * Analyzes all dependencies in a project
   * Processes dependencies in chunks to reduce memory usage for large projects
   * @param projectInfo Project information including all dependencies
   * @returns Complete analysis results with health scores and summaries
   */
  async analyze(
    projectInfo: ProjectInfo,
    options?: { bypassCache?: boolean; includeTransitiveDependencies?: boolean }
  ): Promise<AnalysisResult> {
    const includeTransitive = options?.includeTransitiveDependencies ?? true;
    const startTime = Date.now();
    const packageRoots = new Set(
      (projectInfo.dependencyFiles ?? []).map((df) => df.packageRoot ?? df.path ?? '')
    );
    const isMonorepo = packageRoots.size > 1;

    // 1. Flatten dependency tree (monorepo: keep per-workspace entries, monolith: dedupe)
    const allDependencies = this.collectAllDependencies(
      projectInfo.dependencies,
      isMonorepo,
      includeTransitive
    );
    const totalDeps = allDependencies.length;

    if (includeTransitive) {
      this.log(
        'info',
        `Starting analysis for project with ${totalDeps} dependencies (including transitive) (chunk size: ${this.chunkSize})`
      );
    } else {
      this.log(
        'info',
        `Starting direct-only analysis for project with ${totalDeps} dependencies (transitive disabled) (chunk size: ${this.chunkSize})`
      );
    }

    this.status = {
      isRunning: true,
      progress: 0,
    };
    this.currentAnalysisCacheHits = 0;
    this.licenseContextCache.clear();
    this.cacheManager?.resetStats();

    // Reset network status for this analysis run
    NetworkStatusService.getInstance().reset();

    // Map to store analysis results by dependency name@version
    const analysisMap = new Map<string, DependencyAnalysis>();
    const failedPackages: import('../types').FailedPackage[] = [];
    const totalTransitiveCount = includeTransitive
      ? allDependencies.filter((dep) => dep.isTransitive).length
      : 0;
    const totalDirectCount = totalDeps - totalTransitiveCount;
    let processedCount = 0;
    const baseProgressMessage = includeTransitive
      ? `Analyzing dependencies (${totalDeps} total: ${totalDirectCount} direct, ${totalTransitiveCount} transitive)`
      : `Analyzing dependencies (${totalDirectCount} direct, transitive disabled)`;
    const calcProgress = (processed: number) =>
      Math.min(99, Math.floor((processed / Math.max(totalDeps, 1)) * 95) + 5);
    let errorCount = 0;

    try {
      // Optimize connection pool based on project size
      this.securityAnalyzer.optimizeConnectionPool(totalDeps);

      // Process dependencies in chunks for memory efficiency
      const chunks = this.chunkArray(allDependencies, this.chunkSize);
      const totalChunks = chunks.length;

      this.log(
        'info',
        `Processing ${totalDeps} dependencies in ${totalChunks} chunks of ${this.chunkSize}`
      );

      // Process each chunk sequentially
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];

        this.log(
          'info',
          `Processing chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} dependencies)`
        );
        this.status.currentDependency = baseProgressMessage;
        this.status.progress = Math.max(this.status.progress, calcProgress(processedCount));

        // Execute security, freshness, and compatibility analysis in parallel for this chunk
        const freshnessResultsPromise = Promise.all(
          chunk.map(async (dependency) => {
            if (dependency.isInternal) {
              return {
                freshness: {
                  currentVersion: dependency.version,
                  latestVersion: dependency.version,
                  versionGap: 'current' as const,
                  releaseDate: new Date(),
                  isOutdated: false,
                  isUnmaintained: false,
                } as import('../types').FreshnessAnalysis,
                packageInfo: undefined,
                error: undefined,
              };
            }

            // Lazy Metadata Fetching: Skip expensive metadata fetch for transitive dependencies
            // unless we need it for some reason (currently we don't, as per user request)
            if (dependency.isTransitive) {
              return {
                freshness: {
                  currentVersion: dependency.version,
                  latestVersion: dependency.version, // Unknown, assume current
                  versionGap: 'current' as const,
                  releaseDate: new Date(), // Unknown
                  isOutdated: false,
                  isUnmaintained: false,
                } as import('../types').FreshnessAnalysis,
                packageInfo: undefined,
                error: undefined,
              };
            }

            try {
              const packageInfo = await this.getCachedPackageInfo(
                dependency.name,
                options?.bypassCache
              );
              const freshness = await this.freshnessAnalyzer.analyze(dependency, packageInfo);
              return { freshness, packageInfo, error: undefined };
            } catch (error: unknown) {
              // Log error but don't fail the whole batch yet - we'll handle it in the assembly loop
              this.log(
                'error',
                `Failed freshness for ${dependency.name}@${dependency.version}`,
                error
              );

              // Track network errors for user notification
              if (error instanceof DepPulseError && error.code === ErrorCode.NETWORK_ERROR) {
                NetworkStatusService.getInstance().markDegraded(
                  'version-check',
                  `Version check failed for ${dependency.name}: ${error.message}`
                );
              }
              return {
                freshness: {
                  currentVersion: dependency.version,
                  latestVersion: dependency.version,
                  versionGap: 'current' as const,
                  releaseDate: new Date(),
                  isOutdated: false,
                  isUnmaintained: false,
                } as import('../types').FreshnessAnalysis,
                packageInfo: undefined,
                error,
              };
            }
          })
        );

        const compatibilityResultsPromise = this.compatibilityAnalyzer
          ? freshnessResultsPromise.then((freshnessResults) =>
              Promise.all(
                chunk.map(async (dependency, index) => {
                  // Skip only internal dependencies
                  // Analyze @types/* packages even if transitive, as they're important type definitions
                  // Also analyze other transitive dependencies for compatibility issues
                  if (dependency.isInternal) {
                    return undefined;
                  }
                  try {
                    const freshnessResult = freshnessResults[index];
                    // If freshness analysis failed, still try compatibility analysis
                    // (it can work without freshness data, just won't detect breaking changes from major upgrades)
                    const packageInfo = freshnessResult?.packageInfo;
                    const freshness = freshnessResult?.freshness;
                    if (!this.compatibilityAnalyzer) {
                      return undefined;
                    }
                    return await this.compatibilityAnalyzer.analyze(
                      dependency,
                      packageInfo,
                      freshness
                    );
                  } catch (error: unknown) {
                    // Log but don't fail - compatibility analysis is optional
                    this.log(
                      'warn',
                      `Failed compatibility analysis for ${dependency.name}@${dependency.version}`,
                      error
                    );
                    return undefined;
                  }
                })
              )
            )
          : Promise.resolve<Array<import('../types').CompatibilityAnalysis | undefined>>([]);

        const [securityResults, freshnessResults, compatibilityResults] = await Promise.all([
          this.securityAnalyzer.analyzeBatch(chunk),
          freshnessResultsPromise,
          compatibilityResultsPromise,
        ]);

        // Assemble analyses for this chunk
        for (let i = 0; i < chunk.length; i++) {
          const dependency = chunk[i];
          const key = this.getAnalysisKey(dependency);

          processedCount += 1;
          this.status.currentDependency = baseProgressMessage;
          // Progress increases proportionally with processed dependencies, capped before final
          // aggregation to avoid showing 100% prematurely.
          const workProgress = calcProgress(processedCount);
          this.status.progress = Math.min(Math.max(this.status.progress, workProgress), 99);

          try {
            const { freshness, packageInfo, error } = freshnessResults[i];

            // If there was an error fetching package info/freshness, re-throw it now
            if (error) {
              throw error;
            }

            // Ensure packageInfo is available (should be if no error and not transitive)
            if (!packageInfo && !dependency.isTransitive && !dependency.isInternal) {
              // If it's not transitive and we have no package info, it's an error
              throw new Error(`Package info missing for ${dependency.name}`);
            }

            let license: LicenseAnalysis;

            if (dependency.isTransitive) {
              // Skip metadata fetch for transitive deps - assume compatible to avoid noise
              license = this.licenseAnalyzer.analyze(
                'Unknown',
                true,
                'Transitive dependency - license not analyzed'
              );
            } else if (dependency.isInternal) {
              license = this.licenseAnalyzer.analyze(
                'Internal',
                true,
                'Internal package - always compatible'
              );
            } else {
              const { licenseConfig, projectLicense } =
                await this.getLicenseContextForDependency(dependency);

              // packageInfo is guaranteed to be defined here due to check above
              // But TypeScript might need convincing or we use non-null assertion if we are sure
              if (!packageInfo) {
                throw new Error('Package info missing for non-transitive dependency');
              }
              const info = packageInfo;

              // Parse and analyze license using LicenseAnalyzer
              const parsedLicense = this.licenseAnalyzer.parseLicense(info.license);
              const primarySpdxId = parsedLicense.spdxIds[0] || 'Unknown';
              const category = this.licenseAnalyzer.categorizeLicense(primarySpdxId);

              // Check compatibility using LicenseCompatibilityChecker
              const licenseCompatibilityResult =
                this.licenseCompatibilityChecker.checkCompatibility(
                  {
                    license: parsedLicense.expression,
                    spdxId:
                      parsedLicense.spdxIds.length === 1 ? parsedLicense.spdxIds[0] : undefined,
                    spdxIds: parsedLicense.spdxIds,
                    isCompatible: false, // Will be set by checker
                    licenseType: category.type,
                    riskLevel: category.riskLevel,
                    requiresAttribution: category.requiresAttribution,
                    requiresSourceCode: category.requiresSourceCode,
                  },
                  licenseConfig,
                  projectLicense
                );

              // Create complete license analysis
              license = this.licenseAnalyzer.analyze(
                info.license,
                licenseCompatibilityResult.isCompatible,
                licenseCompatibilityResult.reason
              );
              license.conflictsWith = licenseCompatibilityResult.conflictsWith;

              // Log incompatible licenses for debugging and reporting
              if (!licenseCompatibilityResult.isCompatible) {
                this.log(
                  'warn',
                  `License issue: ${dependency.name}@${dependency.version} - License: "${license.license}", Type: ${license.licenseType}, Risk: ${license.riskLevel || 'unknown'}, Reason: ${licenseCompatibilityResult.reason || 'Not specified'}${licenseCompatibilityResult.conflictsWith ? `, Conflicts: ${licenseCompatibilityResult.conflictsWith.join(', ')}` : ''}`
                );
              }
            }

            // Resolve security result
            let securityResult = securityResults.get(dependency.name);
            if (!securityResult) {
              securityResult = securityResults.get(key);
            }
            // ... (keep existing fallback logic for security results map/object) ...
            if (!securityResult && securityResults instanceof Map) {
              for (const [k, value] of securityResults.entries()) {
                if (k === dependency.name || k.startsWith(`${dependency.name}@`)) {
                  securityResult = value;
                  break;
                }
              }
            }
            if (
              !securityResult &&
              securityResults &&
              typeof securityResults === 'object' &&
              !(securityResults instanceof Map)
            ) {
              for (const [k, value] of Object.entries(
                securityResults as Record<string, SecurityAnalysis>
              )) {
                if (k === dependency.name || k.startsWith(`${dependency.name}@`)) {
                  securityResult = value;
                  break;
                }
              }
            }

            if (!securityResult) {
              securityResult = await this.securityAnalyzer.analyze(
                dependency,
                options?.bypassCache
              );
            }

            // Get compatibility result if available
            const compatibilityResult = compatibilityResults?.[i];

            const analysis: DependencyAnalysis = {
              dependency,
              security: securityResult || { vulnerabilities: [], severity: 'none' },
              freshness,
              license,
              compatibility: compatibilityResult,
              packageInfo,
              isFailed: false,
              maintenanceSignals: freshness.maintenanceSignals,
            };

            // Apply classification
            analysis.classification = this.classifyDependency(analysis);

            // Store in map for reconstruction
            analysisMap.set(key, analysis);
          } catch (error: unknown) {
            // ... error handling ...
            const isPackageNotFound =
              error instanceof DepPulseError &&
              error.code === ErrorCode.API_ERROR &&
              error.message.includes('Package not found');

            if (isPackageNotFound) {
              failedPackages.push({
                name: dependency.name,
                version: dependency.version,
                error: error instanceof Error ? error.message : String(error),
                errorCode: 'PACKAGE_NOT_FOUND',
                isTransitive: dependency.isTransitive,
              });

              const failedAnalysis = this.createFailedAnalysis(dependency, error);
              failedAnalysis.isFailed = true;
              analysisMap.set(key, failedAnalysis);
            } else {
              errorCount++;
              analysisMap.set(key, this.createFailedAnalysis(dependency, error));
            }
          }
        }

        // GC hint
        if (global.gc) global.gc();
      }

      // 2. Reconstruct Tree Structure
      const rootAnalyses: DependencyAnalysis[] = [];

      // Helper to recursively build analysis tree
      const buildTree = (dep: Dependency): DependencyAnalysis | undefined => {
        if (dep.isInternal) {
          return undefined;
        }
        const key = this.getAnalysisKey(dep);
        const analysis = analysisMap.get(key);

        if (!analysis) return undefined;

        // Clone analysis to avoid circular references if same dep appears in multiple places in tree
        // (Though strictly speaking, the analysis object itself is shared, but the structure is tree-like)
        // Actually, we want a new object for the tree node, but pointing to the same data?
        // Let's just use the analysis object. If it's a DAG, it's fine.
        // But wait, 'children' property is on DependencyAnalysis.
        // If we modify 'children' of the cached analysis object, it will affect all occurrences.
        // Since the dependency tree is a tree (or DAG), and we want to reflect that structure...

        // We should create a shallow copy of the analysis for this node in the tree
        const nodeAnalysis: DependencyAnalysis = { ...analysis };

        if (includeTransitive && dep.children && dep.children.length > 0) {
          nodeAnalysis.children = [];
          for (const child of dep.children) {
            const childAnalysis = buildTree(child);
            if (childAnalysis) {
              nodeAnalysis.children.push(childAnalysis);
            }
          }
        }

        return nodeAnalysis;
      };

      // Build tree for top-level dependencies
      for (const dep of projectInfo.dependencies) {
        const analysis = buildTree(dep);
        if (analysis) {
          rootAnalyses.push(analysis);
        }
      }

      // Generate summary based on analyzed dependencies (excluding internal)
      const flatAnalyses = Array.from(analysisMap.values()).filter((a) => !a.dependency.isInternal);
      const directFailedCount = failedPackages.filter((p) => !p.isTransitive).length;

      const directDependencies = projectInfo.dependencies.filter(
        (d) => !d.isTransitive && !d.isInternal
      );
      const totalDirect = directDependencies.length;

      const summaryAnalyses = isMonorepo
        ? directDependencies
            .map((dep) => analysisMap.get(this.getAnalysisKey(dep)))
            .filter((a): a is DependencyAnalysis => Boolean(a))
        : flatAnalyses.filter((a) => !a.dependency.isTransitive);

      const summary = this.generateSummary(
        summaryAnalyses,
        directFailedCount,
        errorCount,
        totalDirect
      );

      const result: AnalysisResult = {
        timestamp: new Date(),
        dependencies: rootAnalyses, // Return the Tree (internal packages filtered out)
        failedPackages: failedPackages.length > 0 ? failedPackages : undefined,
        isMonorepo,
        packageJsonCount: packageRoots.size,
        healthScore: {
          overall: 0,
          security: 0,
          freshness: 0,
          compatibility: 100,
          license: 100,
          breakdown: {
            totalDependencies: summary.totalDependencies,
            criticalIssues: summary.criticalIssues,
            warnings: summary.warnings,
            healthy: summary.healthy,
          },
        },
        summary,
      };

      result.healthScore = this.healthScoreCalculator.calculate(result.dependencies);

      // ... logging and metrics ...
      const duration = Date.now() - startTime;
      this.log(
        'info',
        `Analysis completed in ${duration}ms. Analyzed ${flatAnalyses.length} unique dependencies. Overall health score: ${result.healthScore.overall}`
      );

      result.metadata = {
        cacheHits: this.cacheManager?.getStats().hits || this.currentAnalysisCacheHits,
        cacheRequests: this.cacheManager?.getStats().requests,
        totalDependencies: summary.totalDependencies,
      };

      // ... performance metrics ...
      const memoryUsage = process.memoryUsage();
      const totalTransitiveCount = flatAnalyses.filter((a) => a.dependency.isTransitive).length;
      const failedTransitiveCount = failedPackages.filter((p) => p.isTransitive).length;

      result.performanceMetrics = {
        scanDuration: duration,
        memoryUsage: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          rss: memoryUsage.rss,
        },
        dependencyCount: summary.totalDependencies,
        validDependencyCount: summary.analyzedDependencies,
        invalidDependencyCount: summary.failedDependencies,
        transitiveDependencyCount: totalTransitiveCount + failedTransitiveCount,
      };

      // Add network status to result if there were issues
      const networkStatus = NetworkStatusService.getInstance().getStatus();
      if (NetworkStatusService.getInstance().hasIssues()) {
        result.networkStatus = {
          isOnline: networkStatus.isOnline,
          degradedFeatures: networkStatus.degradedFeatures,
          errors: networkStatus.errors,
        };
      }

      this.cleanupIntermediateData();
      return result;
    } finally {
      this.status = {
        isRunning: false,
        progress: 100,
        currentDependency: undefined,
      };
    }
  }

  /**
   * Recursively collects all unique dependencies from a list of dependencies
   * Preserves accurate distinction between direct dependencies, devDependencies, and transitive dependencies
   * When the same package appears as both direct and transitive, prefers the direct dependency version
   */
  private collectAllDependencies(
    dependencies: Dependency[],
    isMonorepo: boolean,
    includeTransitive: boolean
  ): Dependency[] {
    const seen = new Map<string, Dependency>();

    const traverse = (deps: Dependency[]) => {
      for (const dep of deps) {
        const scope = isMonorepo ? dep.packageRoot || dep.workspaceFolder || '' : '';
        const key = isMonorepo
          ? `${dep.name}@${dep.version}@${scope}`
          : `${dep.name}@${dep.version}`;

        const existing = seen.get(key);

        // Prefer direct dependencies over transitive ones to preserve accurate classification
        // This ensures that packages like @types/node that are direct devDependencies
        // are correctly marked as direct (isTransitive: false), not transitive
        if (!existing) {
          // First time seeing this package - add it
          seen.set(key, dep);
        } else if (!dep.isTransitive && existing.isTransitive) {
          // We found a direct dependency, but we already have it marked as transitive
          // Replace with the direct version to preserve accurate classification
          seen.set(key, dep);
        } else if (dep.isTransitive && !existing.isTransitive) {
          // We found a transitive dependency, but we already have it as direct
          // Keep the direct version (don't replace) - direct dependencies take precedence
          // This ensures @types/node stays as direct devDependency even if it appears transitively
        }
        // If both are direct or both are transitive, keep the first one (existing)
        // This preserves the first occurrence's metadata (isDev, etc.)

        // Recursively process children (they are always transitive)
        if (includeTransitive && dep.children) {
          traverse(dep.children);
        }
      }
    };

    // Start traversal from root level (direct dependencies)
    traverse(dependencies);
    return Array.from(seen.values());
  }

  private getAnalysisKey(dep: Dependency): string {
    const scope = dep.packageRoot || dep.workspaceFolder || '';
    return `${dep.name}@${dep.version}@${scope}`;
  }

  private async getLicenseContextForDependency(dependency: Dependency): Promise<{
    licenseConfig: ReturnType<typeof loadLicenseConfig>;
    projectLicense: string | undefined;
    workspaceFolder?: vscode.WorkspaceFolder;
  }> {
    const workspaceFolder = this.resolveWorkspaceFolderForDependency(dependency);
    const cacheKey = workspaceFolder?.uri.fsPath || '__default__';
    let cached = this.licenseContextCache.get(cacheKey);

    if (!cached) {
      cached = (async () => {
        const licenseConfig = loadLicenseConfig(workspaceFolder);
        const projectLicense = await getProjectLicense(workspaceFolder);
        this.log(
          'info',
          `License config loaded for ${workspaceFolder?.uri.fsPath || 'default'}: ${licenseConfig.acceptableLicenses.length} acceptable licenses, strictMode=${licenseConfig.strictMode}, projectLicense=${projectLicense || 'none'}`
        );
        return { licenseConfig, projectLicense, workspaceFolder };
      })();
      this.licenseContextCache.set(cacheKey, cached);
    }

    return cached;
  }

  private resolveWorkspaceFolderForDependency(
    dependency: Dependency
  ): vscode.WorkspaceFolder | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return undefined;
    }

    const scopePath = dependency.workspaceFolder || dependency.packageRoot;
    if (!scopePath) {
      return workspaceFolders[0];
    }

    const normalizedScope = path.resolve(scopePath);
    return [...workspaceFolders]
      .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
      .find((folder) => {
        const folderPath = path.resolve(folder.uri.fsPath);
        return (
          normalizedScope === folderPath || normalizedScope.startsWith(`${folderPath}${path.sep}`)
        );
      });
  }

  /**
   * Performs incremental analysis on changed dependencies
   * Loads previous analysis from workspace state, re-analyzes changed dependencies,
   * and merges results with unchanged dependencies
   * Processes dependencies in chunks to reduce memory usage
   * @param changes List of dependencies that have changed
   * @returns Updated analysis results with merged data
   */
  async analyzeIncremental(
    changes: Dependency[],
    options?: { bypassCache?: boolean; includeTransitiveDependencies?: boolean }
  ): Promise<AnalysisResult> {
    const includeTransitive = options?.includeTransitiveDependencies ?? true;
    const filteredChanges = includeTransitive
      ? changes
      : changes.filter((dep) => !dep.isTransitive);
    const totalDeps = filteredChanges.length;
    const totalTransitiveCount = includeTransitive
      ? filteredChanges.filter((dep) => dep.isTransitive).length
      : 0;
    const totalDirectCount = totalDeps - totalTransitiveCount;
    let processedCount = 0;
    const baseProgressMessage = includeTransitive
      ? `Analyzing dependencies (${totalDeps} total: ${totalDirectCount} direct, ${totalTransitiveCount} transitive)`
      : `Analyzing dependencies (${totalDirectCount} direct, transitive disabled)`;
    const calcProgress = (processed: number) =>
      Math.min(99, Math.floor((processed / Math.max(totalDeps, 1)) * 95) + 5);

    this.log(
      'info',
      `Starting incremental analysis for ${totalDeps} changed dependencies (transitive ${
        includeTransitive ? 'enabled' : 'disabled'
      }, chunk size: ${this.chunkSize})`
    );

    this.status = {
      isRunning: true,
      progress: 0,
    };
    this.currentAnalysisCacheHits = 0;
    this.licenseContextCache.clear();
    this.cacheManager?.resetStats();

    const startTime = Date.now();
    const dependencyAnalyses: DependencyAnalysis[] = [];
    const failedPackages: import('../types').FailedPackage[] = [];
    let errorCount = 0;

    try {
      // Process dependencies in chunks for memory efficiency
      const chunks = this.chunkArray(filteredChanges, this.chunkSize);
      const totalChunks = chunks.length;

      this.log(
        'info',
        `Processing ${totalDeps} changed dependencies in ${totalChunks} chunks of ${this.chunkSize}`
      );

      // Process each chunk sequentially to control memory usage
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];

        this.log(
          'info',
          `Processing chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} dependencies)`
        );
        this.status.currentDependency = baseProgressMessage;
        this.status.progress = Math.max(this.status.progress, calcProgress(processedCount));

        // Execute security, freshness, and compatibility analysis in parallel for this chunk
        const freshnessResultsPromise = Promise.all(
          chunk.map(async (dependency) => {
            try {
              const packageInfo = await this.getCachedPackageInfo(
                dependency.name,
                options?.bypassCache
              );
              const freshness = await this.freshnessAnalyzer.analyze(dependency, packageInfo);
              return { freshness, packageInfo, error: undefined };
            } catch (error: unknown) {
              // Log error but don't fail the whole batch yet - we'll handle it in the assembly loop
              return {
                freshness: {
                  currentVersion: dependency.version,
                  latestVersion: dependency.version,
                  versionGap: 'current' as const,
                  releaseDate: new Date(),
                  isOutdated: false,
                  isUnmaintained: false,
                },
                packageInfo: undefined,
                error,
              };
            }
          })
        );

        const compatibilityResultsPromise = this.compatibilityAnalyzer
          ? freshnessResultsPromise.then((freshnessResults) =>
              Promise.all(
                chunk.map(async (dependency, index) => {
                  // Skip only internal dependencies
                  // Analyze @types/* packages even if transitive, as they're important type definitions
                  // Also analyze other transitive dependencies for compatibility issues
                  if (dependency.isInternal) {
                    return undefined;
                  }
                  try {
                    const freshnessResult = freshnessResults[index];
                    // If freshness analysis failed, still try compatibility analysis
                    // (it can work without freshness data, just won't detect breaking changes from major upgrades)
                    const packageInfo = freshnessResult?.packageInfo;
                    const freshness = freshnessResult?.freshness;
                    if (!this.compatibilityAnalyzer) {
                      return undefined;
                    }
                    return await this.compatibilityAnalyzer.analyze(
                      dependency,
                      packageInfo,
                      freshness
                    );
                  } catch (error: unknown) {
                    // Log but don't fail - compatibility analysis is optional
                    this.log(
                      'warn',
                      `Failed compatibility analysis for ${dependency.name}@${dependency.version}`,
                      error
                    );
                    return undefined;
                  }
                })
              )
            )
          : Promise.resolve<Array<import('../types').CompatibilityAnalysis | undefined>>([]);

        const [securityResults, freshnessResults, compatibilityResults] = await Promise.all([
          // Batch security analysis for chunk dependencies
          this.securityAnalyzer.analyzeBatch(chunk),
          // Parallelize freshness analysis for chunk dependencies
          freshnessResultsPromise,
          compatibilityResultsPromise,
        ]);

        // Assemble analyses for this chunk
        for (let i = 0; i < chunk.length; i++) {
          const dependency = chunk[i];
          processedCount += 1;
          this.status.currentDependency = baseProgressMessage;
          // Progress increases proportionally with processed dependencies, capped before final
          // aggregation to avoid showing 100% prematurely.
          const workProgress = calcProgress(processedCount);
          this.status.progress = Math.min(Math.max(this.status.progress, workProgress), 99);

          try {
            const { freshness, packageInfo, error } = freshnessResults[i];

            // If there was an error fetching package info/freshness, re-throw it now
            if (error) {
              throw error;
            }

            // Ensure packageInfo is available (should be if no error)
            if (!packageInfo) {
              throw new Error(`Package info missing for ${dependency.name}`);
            }

            const { licenseConfig, projectLicense } =
              await this.getLicenseContextForDependency(dependency);

            // Parse and analyze license using LicenseAnalyzer
            const parsedLicense = this.licenseAnalyzer.parseLicense(packageInfo.license);
            const primarySpdxId = parsedLicense.spdxIds[0] || 'Unknown';
            const category = this.licenseAnalyzer.categorizeLicense(primarySpdxId);

            // Check compatibility using LicenseCompatibilityChecker
            const licenseCompatibilityResult = this.licenseCompatibilityChecker.checkCompatibility(
              {
                license: parsedLicense.expression,
                spdxId: parsedLicense.spdxIds.length === 1 ? parsedLicense.spdxIds[0] : undefined,
                spdxIds: parsedLicense.spdxIds,
                isCompatible: false, // Will be set by checker
                licenseType: category.type,
                riskLevel: category.riskLevel,
                requiresAttribution: category.requiresAttribution,
                requiresSourceCode: category.requiresSourceCode,
              },
              licenseConfig,
              projectLicense
            );

            // Create complete license analysis
            const license = this.licenseAnalyzer.analyze(
              packageInfo.license,
              licenseCompatibilityResult.isCompatible,
              licenseCompatibilityResult.reason
            );
            license.conflictsWith = licenseCompatibilityResult.conflictsWith;

            // Log incompatible licenses for debugging and reporting
            if (!licenseCompatibilityResult.isCompatible) {
              this.log(
                'warn',
                `License issue: ${dependency.name}@${dependency.version} - License: "${license.license}", Type: ${license.licenseType}, Risk: ${license.riskLevel || 'unknown'}, Reason: ${licenseCompatibilityResult.reason || 'Not specified'}${licenseCompatibilityResult.conflictsWith ? `, Conflicts: ${licenseCompatibilityResult.conflictsWith.join(', ')}` : ''}`
              );
            }

            const maintenanceSignals = freshness.maintenanceSignals;

            // Try to get security results by name first (standard case)
            // If not found, try composite key (name@version) for cases with duplicate names
            let securityResult = securityResults.get(dependency.name);
            if (!securityResult) {
              const compositeKey = `${dependency.name}@${dependency.version}`;
              securityResult = securityResults.get(compositeKey);
            }

            // Get compatibility result if available
            const compatibilityResult = compatibilityResults?.[i];

            const analysis: DependencyAnalysis = {
              dependency,
              security: securityResult || {
                vulnerabilities: [],
                severity: 'none',
              },
              freshness,
              license,
              compatibility: compatibilityResult,
              packageInfo,
              isFailed: false,
              maintenanceSignals,
            };

            // Apply classification
            const classification = this.classifyDependency(analysis);
            analysis.classification = classification;

            dependencyAnalyses.push(analysis);
          } catch (error: unknown) {
            // Check if this is a package not found error (NPM registry 404)
            // Use loose check for code to handle potential instanceof issues in tests
            const isPackageNotFound =
              (error instanceof DepPulseError ||
                (error as { code?: string }).code === ErrorCode.API_ERROR) &&
              error instanceof Error &&
              error.message.includes('Package not found');

            if (isPackageNotFound) {
              // This is a fake/non-existent package - track it separately
              failedPackages.push({
                name: dependency.name,
                version: dependency.version,
                error: error instanceof Error ? error.message : String(error),
                errorCode: 'PACKAGE_NOT_FOUND',
                isTransitive: dependency.isTransitive,
              });
              this.log(
                'warn',
                `Package does not exist in NPM registry (likely invalid/fake package): ${dependency.name}@${dependency.version}`
              );

              // Still add to analyses but mark as failed (excluded from health score)
              const failedAnalysis = this.createFailedAnalysis(dependency, error, true);
              dependencyAnalyses.push(failedAnalysis);
            } else {
              // Other error during analysis
              this.log(
                'error',
                `Failed to analyze ${dependency.name}@${dependency.version}`,
                error
              );
              errorCount++;
              dependencyAnalyses.push(this.createFailedAnalysis(dependency, error, false));
            }
          }
        }

        // Release memory after processing chunk
        this.log('info', `Chunk ${chunkIndex + 1}/${totalChunks} completed, memory released`);

        // Force garbage collection hint (if available)
        if (global.gc) {
          global.gc();
        }
      }

      // 3. Generate summary and health score (exclude internal packages)
      const externalAnalyses = dependencyAnalyses.filter((d) => !d.dependency.isInternal);
      const totalDirectDependencies = externalAnalyses.filter(
        (a) => !a.dependency.isTransitive && !a.dependency.isInternal
      ).length;
      const summary = this.generateSummary(
        externalAnalyses,
        failedPackages.length,
        errorCount,
        totalDirectDependencies
      );
      const healthScore = this.healthScoreCalculator.calculate(externalAnalyses);

      // 4. Create performance metrics
      const duration = Date.now() - startTime;
      const memoryUsage = process.memoryUsage();

      const performanceMetrics: import('../types').PerformanceMetrics = {
        scanDuration: duration,
        memoryUsage: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          rss: memoryUsage.rss,
        },
        dependencyCount: summary.totalDependencies,
        validDependencyCount: summary.analyzedDependencies,
        invalidDependencyCount: failedPackages.length,
        transitiveDependencyCount: externalAnalyses.filter((d) => d.dependency.isTransitive).length, // Corrected to use dependencyAnalyses
      };

      this.log('info', `Analysis complete in ${duration}ms. Score: ${healthScore.overall}`);

      return {
        timestamp: new Date(),
        dependencies: externalAnalyses,
        summary,
        healthScore,
        performanceMetrics,
        failedPackages: failedPackages.length > 0 ? failedPackages : undefined,
      };
    } finally {
      this.status = {
        isRunning: false,
        progress: 100,
      };
      this.cleanupIntermediateData();
    }
  }

  /**
   * Gets the current analysis status
   * @returns Current status including progress and running state
   */
  getAnalysisStatus(): AnalysisStatus {
    return { ...this.status };
  }

  /**
   * Fetches package info with caching
   * @param packageName Name of the package to fetch
   * @returns Package info from registry or cache
   */
  private async getCachedPackageInfo(
    packageName: string,
    bypassCache: boolean = false
  ): Promise<import('../types').PackageInfo> {
    const CACHE_KEY = `npm_info_${packageName}`;
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    const NEGATIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for failed lookups

    // Check positive cache (successful package info)
    // Skip cache check if bypassCache is true
    if (!bypassCache) {
      if (this.cacheManager) {
        // Use file-based cache if available
        const cached = await this.cacheManager.getCachedNpmInfo(packageName);
        if (cached) {
          this.log('info', `Cache hit for ${packageName}`);
          this.currentAnalysisCacheHits++;
          return cached;
        }
      } else {
        // Fallback to globalState (legacy)
        const cached = this.context.globalState.get<{
          data: import('../types').PackageInfo;
          timestamp: number;
        }>(CACHE_KEY);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
          this.log('info', `Cache hit for ${packageName} (legacy globalState)`);
          this.currentAnalysisCacheHits++; // Track cache hit
          // Deserialize Date object from cache (it's stored as string in JSON)
          const data = cached.data;
          if (typeof data.publishedAt === 'string') {
            data.publishedAt = new Date(data.publishedAt);
          }
          return data;
        }
      }
    } else {
      this.log('info', `Bypassing cache for ${packageName} (force refresh)`);
    }

    // Check negative cache (failed package lookups)
    const NEGATIVE_CACHE_KEY = `npm_info_failed_${packageName}`;
    const negativeCached = this.context.globalState.get<{
      error: string;
      timestamp: number;
    }>(NEGATIVE_CACHE_KEY);
    if (negativeCached && Date.now() - negativeCached.timestamp < NEGATIVE_CACHE_TTL_MS) {
      this.log('info', `Negative cache hit for ${packageName} - package known to not exist`);
      // Re-throw the cached error
      throw new DepPulseError(negativeCached.error, ErrorCode.API_ERROR, true, {
        packageName,
        cachedError: true,
      });
    }

    this.log('info', `Fetching package info for: ${packageName}`);

    try {
      const info = await this.registryClient.getPackageInfo(packageName);

      // Cache successful result
      if (this.cacheManager) {
        await this.cacheManager.cacheNpmInfo(packageName, info);
      } else {
        this.context.globalState.update(CACHE_KEY, {
          data: info,
          timestamp: Date.now(),
        });
      }
      // Clear negative cache if it exists (package might have been published since last check)
      this.context.globalState.update(NEGATIVE_CACHE_KEY, undefined);
      return info;
    } catch (error: unknown) {
      // Cache "Package not found" errors to avoid repeated failed API calls
      const isPackageNotFound =
        error instanceof DepPulseError &&
        error.code === ErrorCode.API_ERROR &&
        error.message.includes('Package not found');
      if (isPackageNotFound) {
        this.log('info', `Caching failed lookup for ${packageName} (negative cache for 7 days)`);
        this.context.globalState.update(NEGATIVE_CACHE_KEY, {
          error: error.message,
          timestamp: Date.now(),
        });
      }
      // Re-throw the error
      throw error;
    }
  }

  /**
   * Applies classification hierarchy to determine primary status
   * Priority: Critical Security > High Security > Medium Security > Low Security >
   *           Unmaintained > Major Outdated > Minor Outdated > Patch Outdated > Healthy
   */
  private classifyDependency(analysis: DependencyAnalysis): DependencyClassification {
    // Handle failed/unknown packages (e.g. fake packages)
    if (analysis.isFailed) {
      return {
        primary: { type: 'unknown' },
        allIssues: [],
        displayPriority: 10,
      };
    }

    const allIssues = this.collectAllIssues(analysis);

    // Determine primary classification based on hierarchy
    let primary: ClassificationCategory;
    let displayPriority: number;

    // Check for security issues first (highest priority)
    if (analysis.security.severity === 'critical') {
      primary = { type: 'security', severity: 'critical' };
      displayPriority = 1;
    } else if (analysis.security.severity === 'high') {
      primary = { type: 'security', severity: 'high' };
      displayPriority = 2;
    } else if (analysis.security.severity === 'medium') {
      primary = { type: 'security', severity: 'medium' };
      displayPriority = 3;
    } else if (analysis.security.severity === 'low') {
      primary = { type: 'security', severity: 'low' };
      displayPriority = 4;
    }
    // Check for unmaintained status
    else if (analysis.freshness.isUnmaintained) {
      const daysSinceUpdate = Math.floor(
        (Date.now() - analysis.freshness.releaseDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      primary = { type: 'unmaintained', daysSinceUpdate };
      displayPriority = 5;
    }
    // Check for outdated status
    else if (analysis.freshness.isOutdated) {
      primary = {
        type: 'outdated',
        gap: analysis.freshness.versionGap as 'major' | 'minor' | 'patch',
        gracePeriod: false,
      };
      // Priority based on version gap
      displayPriority =
        analysis.freshness.versionGap === 'major'
          ? 6
          : analysis.freshness.versionGap === 'minor'
            ? 7
            : 8;
    }
    // Healthy
    else {
      primary = { type: 'healthy' };
      displayPriority = 9;
    }

    return {
      primary,
      allIssues,
      displayPriority,
    };
  }

  /**
   * Collects all issues for a dependency (not just primary)
   */
  private collectAllIssues(analysis: DependencyAnalysis): DependencyIssue[] {
    const issues: DependencyIssue[] = [];

    // Collect security issues
    if (analysis.security.vulnerabilities.length > 0) {
      for (const vuln of analysis.security.vulnerabilities) {
        issues.push({
          category: 'security',
          severity: vuln.severity as 'critical' | 'high' | 'medium' | 'low',
          title: vuln.title,
          description: vuln.description,
          actionable: true,
          suggestedAction: vuln.patchedVersions
            ? `Update to ${vuln.patchedVersions}`
            : 'Review vulnerability and consider alternatives',
        });
      }
    }

    // Collect maintenance issues
    if (analysis.freshness.isUnmaintained) {
      const daysSinceUpdate = Math.floor(
        (Date.now() - analysis.freshness.releaseDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      issues.push({
        category: 'maintenance',
        severity: 'medium',
        title: 'Package appears unmaintained',
        description: `No updates in ${daysSinceUpdate} days (${Math.floor(daysSinceUpdate / 365)} years)`,
        actionable: true,
        suggestedAction: 'Consider finding an actively maintained alternative',
      });
    }

    // Collect freshness issues
    if (analysis.freshness.isOutdated) {
      const severity =
        analysis.freshness.versionGap === 'major'
          ? 'medium'
          : analysis.freshness.versionGap === 'minor'
            ? 'low'
            : 'info';
      issues.push({
        category: 'freshness',
        severity,
        title: `${analysis.freshness.versionGap.charAt(0).toUpperCase() + analysis.freshness.versionGap.slice(1)} version update available`,
        description: `Current: ${analysis.freshness.currentVersion}, Latest: ${analysis.freshness.latestVersion}`,
        actionable: true,
        suggestedAction: `Update to ${analysis.freshness.latestVersion}`,
      });
    }

    return issues;
  }

  /**
   * Creates a failed analysis entry for dependencies that couldn't be analyzed
   */
  private createFailedAnalysis(
    dependency: Dependency,
    _error: unknown,
    isFailed = false
  ): DependencyAnalysis {
    return {
      dependency,
      security: {
        vulnerabilities: [],
        severity: 'none',
      },
      freshness: {
        currentVersion: dependency.version,
        latestVersion: dependency.version,
        versionGap: 'current',
        releaseDate: new Date(),
        isOutdated: false,
        isUnmaintained: false,
        maintenanceSignals: {
          isLongTermUnmaintained: false,
          reasons: [],
          lastChecked: new Date(),
        },
      },
      license: this.licenseAnalyzer.analyze(
        'Unknown',
        true,
        'Failed package - license not analyzed'
      ),
      maintenanceSignals: {
        isLongTermUnmaintained: false,
        reasons: [],
        lastChecked: new Date(),
      },
      // Explicitly set isFailed based on parameter
      isFailed,
    };
  }

  /**
   * Generates analysis summary with counts and statistics
   * Uses new classification system for accurate counting
   * Only counts successfully analyzed packages (excludes failed/fake packages)
   */
  private generateSummary(
    analyses: DependencyAnalysis[],
    failedCount: number,
    errorCount: number,
    totalDirectDependencies: number
  ): AnalysisSummary {
    let criticalIssues = 0;
    let highIssues = 0;
    let warnings = 0;
    let healthy = 0;

    // Filter out failed packages (fake/non-existent) from classification
    // Only exclude packages explicitly marked as failed (isFailed === true)
    const realPackages = analyses.filter((a) => a.isFailed !== true);

    for (const analysis of realPackages) {
      if (!analysis.classification) {
        // Fallback to old logic if classification not available
        if (analysis.security.severity === 'critical') {
          criticalIssues++;
        } else if (analysis.security.severity === 'high') {
          highIssues++;
        } else if (
          analysis.security.severity === 'medium' ||
          analysis.security.severity === 'low' ||
          analysis.freshness.isOutdated ||
          analysis.freshness.isUnmaintained
        ) {
          warnings++;
        } else {
          healthy++;
        }
        continue;
      }

      // Use classification hierarchy for counting
      const { primary } = analysis.classification;

      if (primary.type === 'security') {
        if (primary.severity === 'critical') {
          criticalIssues++;
        } else if (primary.severity === 'high') {
          highIssues++;
        } else {
          warnings++;
        }
      } else if (primary.type === 'unmaintained') {
        warnings++;
      } else if (primary.type === 'outdated') {
        if (primary.gap === 'major') {
          warnings++;
        } else {
          // Minor and patch updates are less critical
          healthy++;
        }
      } else {
        healthy++;
      }
    }

    const analyzedDependencies = Math.max(totalDirectDependencies - failedCount, 0);

    return {
      totalDependencies: totalDirectDependencies,
      analyzedDependencies,
      failedDependencies: failedCount,
      criticalIssues,
      highIssues,
      warnings,
      healthy,
      errors: errorCount > 0 ? errorCount : undefined,
    };
  }

  /**
   * Splits an array into chunks of specified size
   * Used for stream processing large dependency lists
   * @param array Array to chunk
   * @param size Chunk size
   * @returns Array of chunks
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Clean up intermediate data structures after analysis completes
   * Helps free memory by clearing references that are no longer needed
   */
  private cleanupIntermediateData(): void {
    // Clear status currentDependency reference (already done in finally block, but explicit here)
    // This helps ensure no lingering references to dependency strings
    if (this.status.currentDependency) {
      this.status.currentDependency = undefined;
    }

    // Note: Local variables (securityResults, freshnessResults) in analyze() method
    // are automatically garbage collected when method completes.
    // This method provides a hook for future cleanup needs and ensures
    // status is properly reset.

    this.log('info', 'Intermediate data structures cleaned up');
  }

  /**
   * Logs messages to the output channel
   */
  private log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] AnalysisEngine: ${message}`;
    this.outputChannel.appendLine(logMessage);

    if (data) {
      if (data instanceof Error) {
        this.outputChannel.appendLine(`  Error: ${data.message}`);
        if (data.stack) {
          this.outputChannel.appendLine(`  Stack: ${data.stack}`);
        }
      } else {
        this.outputChannel.appendLine(JSON.stringify(data, null, 2));
      }
    }
  }
}
