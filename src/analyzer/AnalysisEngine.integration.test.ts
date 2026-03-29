import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import { GitHubAdvisoryClient } from '../api/GitHubAdvisoryClient';
import { NpmRegistryClient } from '../api/NpmRegistryClient';
import { OSVClient } from '../api/OSVClient';
import * as LicenseConfig from '../config/LicenseConfig';
import type {
  Dependency,
  PackageRegistryClient,
  ProjectInfo,
  Vulnerability,
  VulnerabilityClient,
  VulnerabilitySource,
} from '../types';
import { RequestQueue } from '../utils/RequestQueue';
import { AnalysisEngine } from './AnalysisEngine';
import { CompatibilityAnalyzer } from './CompatibilityAnalyzer';
import { FreshnessAnalyzer } from './FreshnessAnalyzer';
import { SecurityAnalyzer } from './SecurityAnalyzer';
import { VulnerabilityAggregator } from './VulnerabilityAggregator';

const workspaceState = {
  folders: [{ uri: { fsPath: '/test/project' } }],
};

// Mock vscode
vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(),
  },
  workspace: {
    get workspaceFolders() {
      return workspaceState.folders;
    },
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
      update: vi.fn(),
      inspect: vi.fn(() => ({ globalValue: undefined, workspaceValue: undefined })),
    })),
  },
  ExtensionContext: {},
}));

// Mock output channel
const createMockOutputChannel = (): vscode.OutputChannel => ({
  name: 'test',
  append: vi.fn(),
  appendLine: vi.fn(),
  replace: vi.fn(),
  clear: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
});

// Mock extension context
const createMockContext = (): vscode.ExtensionContext => ({
  subscriptions: [],
  workspaceState: {} as unknown as vscode.Memento,
  globalState: {
    get: vi.fn(),
    update: vi.fn(),
    keys: vi.fn(),
    setKeysForSync: vi.fn(),
  } as unknown as vscode.Memento & { setKeysForSync(keys: readonly string[]): void },
  extensionPath: '/test/extension',
  globalStoragePath: '/test/storage',
  logPath: '/test/logs',
  extensionUri: {} as unknown as vscode.Uri,
  environmentVariableCollection: {} as unknown as vscode.GlobalEnvironmentVariableCollection,
  secrets: {} as unknown as vscode.SecretStorage,
  extensionMode: 1,
  storagePath: '/test/storage',
  globalStorageUri: {} as unknown as vscode.Uri,
  logUri: {} as unknown as vscode.Uri,
  storageUri: {} as unknown as vscode.Uri,
  languageModelAccessInformation: {} as unknown as vscode.LanguageModelAccessInformation,
  extension: {} as unknown as vscode.Extension<unknown>,
  asAbsolutePath: vi.fn((path: string) => `/test/extension/${path}`),
});

describe('AnalysisEngine - End-to-End Integration', () => {
  let mockOutputChannel: vscode.OutputChannel;
  let mockContext: vscode.ExtensionContext;
  let osvClient: OSVClient;
  let githubClient: GitHubAdvisoryClient;
  let aggregator: VulnerabilityAggregator;
  let securityAnalyzer: SecurityAnalyzer;
  let freshnessAnalyzer: FreshnessAnalyzer;
  let compatibilityAnalyzer: CompatibilityAnalyzer;
  let registryClient: PackageRegistryClient;
  let analysisEngine: AnalysisEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceState.folders = [{ uri: { fsPath: '/test/project' } }];
    mockOutputChannel = createMockOutputChannel();
    mockContext = createMockContext();

    osvClient = new OSVClient(mockOutputChannel);
    githubClient = new GitHubAdvisoryClient(mockOutputChannel);
    const clients = new Map<VulnerabilitySource, VulnerabilityClient>([
      ['osv', osvClient],
      ['github', githubClient],
    ]);
    const requestQueue = new RequestQueue(10);
    aggregator = new VulnerabilityAggregator(clients, requestQueue, mockOutputChannel, ['osv']);
    registryClient = new NpmRegistryClient(mockOutputChannel);
    vi.spyOn(registryClient, 'getVersionDeprecationStatus').mockResolvedValue(null);
    securityAnalyzer = new SecurityAnalyzer(aggregator, mockOutputChannel);
    freshnessAnalyzer = new FreshnessAnalyzer(registryClient, mockOutputChannel);
    compatibilityAnalyzer = new CompatibilityAnalyzer(registryClient, mockOutputChannel);
    analysisEngine = new AnalysisEngine(
      securityAnalyzer,
      freshnessAnalyzer,
      registryClient,
      mockOutputChannel,
      mockContext,
      50,
      undefined,
      compatibilityAnalyzer
    );
  });

  describe('Full Scan Workflow', () => {
    it('loads license settings from the dependency workspace in multi-root mode', async () => {
      workspaceState.folders = [{ uri: { fsPath: '/repo-a' } }, { uri: { fsPath: '/repo-b' } }];

      const loadLicenseConfigSpy = vi
        .spyOn(LicenseConfig, 'loadLicenseConfig')
        .mockImplementation((workspaceFolder?: vscode.WorkspaceFolder) => ({
          acceptableLicenses: [workspaceFolder?.uri.fsPath || 'default'],
          strictMode: false,
          projectLicense: undefined,
        }));
      vi.spyOn(LicenseConfig, 'getProjectLicense').mockResolvedValue('MIT');
      vi.spyOn(securityAnalyzer, 'analyzeBatch').mockResolvedValue(new Map());
      vi.spyOn(freshnessAnalyzer, 'analyze').mockResolvedValue({
        currentVersion: '1.0.0',
        latestVersion: '1.0.0',
        versionGap: 'current',
        releaseDate: new Date(),
        isOutdated: false,
        isUnmaintained: false,
      });
      vi.spyOn(compatibilityAnalyzer, 'analyze').mockResolvedValue({
        status: 'unknown',
        issues: [],
      });
      vi.spyOn(registryClient, 'getPackageInfo').mockResolvedValue({
        name: 'pkg-b',
        version: '1.0.0',
        description: 'test',
        homepage: '',
        repository: '',
        license: 'MIT',
        publishedAt: new Date(),
      } as Awaited<ReturnType<PackageRegistryClient['getPackageInfo']>>);

      const projectInfo: ProjectInfo = {
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/repo-b/package.json',
            type: 'npm',
            packageRoot: '/repo-b',
            workspaceFolder: '/repo-b',
            dependencies: [
              {
                name: 'pkg-b',
                version: '1.0.0',
                versionConstraint: '^1.0.0',
                isDev: false,
                packageRoot: '/repo-b',
                workspaceFolder: '/repo-b',
              },
            ],
          },
        ],
        dependencies: [
          {
            name: 'pkg-b',
            version: '1.0.0',
            versionConstraint: '^1.0.0',
            isDev: false,
            packageRoot: '/repo-b',
            workspaceFolder: '/repo-b',
          },
        ],
      };

      await analysisEngine.analyze(projectInfo, { includeTransitiveDependencies: false });

      expect(loadLicenseConfigSpy).toHaveBeenCalledWith(
        expect.objectContaining({ uri: expect.objectContaining({ fsPath: '/repo-b' }) })
      );
      expect(loadLicenseConfigSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ uri: expect.objectContaining({ fsPath: '/repo-a' }) })
      );
    }, 10000);

    it('should complete full analysis workflow for small project', async () => {
      const dependencies: Dependency[] = [
        { name: 'lodash', version: '4.17.20', versionConstraint: '4.17.20', isDev: false },
        { name: 'express', version: '4.17.1', versionConstraint: '4.17.1', isDev: false },
      ];

      const projectInfo: ProjectInfo = {
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/test/project/package.json',
            type: 'npm',
            dependencies,
          },
        ],
        dependencies,
      };

      // Mock vulnerability responses using getBatchVulnerabilities
      const osvBatchSpy = vi
        .spyOn(osvClient, 'getBatchVulnerabilities')
        .mockImplementation(async (deps: Dependency[]) => {
          const results = new Map<string, Vulnerability[]>();
          for (const dep of deps) {
            if (dep.name === 'lodash') {
              results.set(dep.name, [
                {
                  id: 'CVE-2021-23337',
                  title: 'Prototype Pollution',
                  description: 'Test vulnerability',
                  severity: 'high',
                  affectedVersions: '<4.17.21',
                  references: [],
                  sources: ['osv'],
                  publishedDate: new Date(),
                  lastModifiedDate: new Date(),
                },
              ]);
            } else {
              results.set(dep.name, []);
            }
          }
          return results;
        });

      // Mock package registry
      vi.spyOn(registryClient, 'getPackageInfo').mockImplementation(async (name: string) => {
        if (name === 'lodash') {
          return {
            name: 'lodash',
            version: '4.17.20',
            description: 'Test package',
            homepage: 'https://lodash.com',
            repository: 'https://github.com/lodash/lodash',
            license: 'MIT',
            publishedAt: new Date('2020-01-01'),
          };
        }
        if (name === 'express') {
          return {
            name: 'express',
            version: '4.17.1',
            description: 'Test package',
            homepage: 'https://expressjs.com',
            repository: 'https://github.com/expressjs/express',
            license: 'MIT',
            publishedAt: new Date('2021-01-01'),
          };
        }
        return {
          name,
          version: '1.0.0',
          description: 'Test',
          homepage: '',
          repository: '',
          license: 'MIT',
          publishedAt: new Date(),
        };
      });

      const securityResults = await securityAnalyzer.analyzeBatch(dependencies);
      expect(osvBatchSpy).toHaveBeenCalled();
      expect(securityResults.get('lodash')?.severity).toBe('high');

      const result = await analysisEngine.analyze(projectInfo);

      expect(result).toBeDefined();
      expect(result.dependencies).toHaveLength(2);
      expect(result.healthScore.overall).toBeGreaterThanOrEqual(0);
      expect(result.healthScore.overall).toBeLessThanOrEqual(100);
      expect(result.summary.totalDependencies).toBe(2);
    });

    it('should handle large project with 100+ dependencies', async () => {
      const dependencies: Dependency[] = Array.from({ length: 120 }).map((_, index) => ({
        name: `package-${index}`,
        version: '1.0.0',
        versionConstraint: '1.0.0',
        isDev: false,
      }));

      const projectInfo: ProjectInfo = {
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/test/project/package.json',
            type: 'npm',
            dependencies,
          },
        ],
        dependencies,
      };

      vi.spyOn(registryClient, 'getPackageInfo').mockImplementation(async (name: string) => ({
        name,
        version: '1.0.0',
        description: 'Test',
        homepage: '',
        repository: '',
        license: 'MIT',
        publishedAt: new Date(),
      }));

      const mockVulnerability: Vulnerability = {
        id: 'CVE-2021-23337',
        title: 'Prototype Pollution',
        description: 'Test vulnerability',
        severity: 'high',
        affectedVersions: '<4.17.21',
        references: [],
        sources: ['osv'],
        publishedDate: new Date(),
        lastModifiedDate: new Date(),
      };

      vi.spyOn(osvClient, 'getBatchVulnerabilities').mockImplementation(
        async (deps: Dependency[]) => {
          const results = new Map<string, Vulnerability[]>();
          for (const dep of deps) {
            results.set(dep.name, dep.name === 'package-0' ? [mockVulnerability] : []);
          }
          return results;
        }
      );

      const result = await analysisEngine.analyze(projectInfo);

      expect(result.summary.totalDependencies).toBe(120);
      expect(result.summary.highIssues).toBeGreaterThan(0);
      expect(result.healthScore.overall).toBeLessThan(100);
    });
  });

  describe('Compatibility Analysis Integration', () => {
    it('should include compatibility analysis in full workflow', async () => {
      const dependencies: Dependency[] = [
        {
          name: 'express',
          version: '4.17.1',
          versionConstraint: '^4.17.1',
          isDev: false,
        },
      ];

      const projectInfo: ProjectInfo = {
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/test/package.json',
            type: 'npm',
            dependencies,
          },
        ],
        dependencies,
      };

      // Mock registry to return package info
      vi.spyOn(registryClient, 'getPackageInfo').mockResolvedValue({
        name: 'express',
        version: '4.18.0',
        description: 'Fast web framework',
        license: 'MIT',
        publishedAt: new Date(),
      });

      vi.spyOn(registryClient, 'getVersionDeprecationStatus').mockResolvedValue(null);

      const result = await analysisEngine.analyze(projectInfo);

      expect(result.dependencies).toHaveLength(1);
      expect(result.dependencies[0].compatibility).toBeDefined();
      expect(result.healthScore.compatibility).toBeDefined();
      expect(result.healthScore.compatibility).toBeGreaterThanOrEqual(0);
      expect(result.healthScore.compatibility).toBeLessThanOrEqual(100);
    }, 15000);

    it('should detect deprecated versions in integration', async () => {
      const dependencies: Dependency[] = [
        {
          name: 'deprecated-pkg',
          version: '1.0.0',
          versionConstraint: '^1.0.0',
          isDev: false,
        },
      ];

      const projectInfo: ProjectInfo = {
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/test/package.json',
            type: 'npm',
            dependencies,
          },
        ],
        dependencies,
      };

      vi.spyOn(registryClient, 'getPackageInfo').mockResolvedValue({
        name: 'deprecated-pkg',
        version: '2.0.0',
        description: 'Test package',
        license: 'MIT',
        publishedAt: new Date(),
      });

      vi.spyOn(registryClient, 'getVersionDeprecationStatus').mockResolvedValue(
        'Version 1.0.0 is deprecated. Please upgrade to 2.0.0.'
      );

      const result = await analysisEngine.analyze(projectInfo);

      expect(result.dependencies[0].compatibility).toBeDefined();
      expect(result.dependencies[0].compatibility?.status).toBe('version-deprecated');
      expect(result.dependencies[0].compatibility?.issues.length).toBeGreaterThan(0);
      expect(result.healthScore.compatibility).toBeLessThan(100);
    }, 15000);

    it('should detect breaking changes for major version upgrades', async () => {
      const dependencies: Dependency[] = [
        {
          name: 'test-pkg',
          version: '1.0.0',
          versionConstraint: '^1.0.0',
          isDev: false,
        },
      ];

      const projectInfo: ProjectInfo = {
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/test/package.json',
            type: 'npm',
            dependencies,
          },
        ],
        dependencies,
      };

      vi.spyOn(registryClient, 'getPackageInfo').mockResolvedValue({
        name: 'test-pkg',
        version: '2.0.0',
        description: 'Test package',
        license: 'MIT',
        publishedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
      });

      vi.spyOn(registryClient, 'getVersionDeprecationStatus').mockResolvedValue(null);

      const result = await analysisEngine.analyze(projectInfo);

      expect(result.dependencies[0].compatibility).toBeDefined();
      // Should detect breaking changes for major version gap
      if (
        result.dependencies[0].freshness.versionGap === 'major' &&
        result.dependencies[0].freshness.isOutdated
      ) {
        expect(result.dependencies[0].compatibility?.status).toBe('breaking-changes');
        expect(result.dependencies[0].compatibility?.upgradeWarnings).toBeDefined();
      }
    }, 15000);
  });
});
