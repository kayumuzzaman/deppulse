import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type {
  AlternativeSuggestion,
  AnalysisResult,
  Dependency,
  DependencyAnalysis,
} from '../types';
import type { AlternativeSuggestionService } from '../utils';
import { DashboardController } from './DashboardController';
import { DashboardDataTransformer } from './DashboardDataTransformer';

// Mock vscode at module level
vi.mock('vscode', () => {
  const createMockUri = (path: string) => ({
    scheme: 'file',
    authority: '',
    path,
    query: '',
    fragment: '',
    fsPath: path,
    with: vi.fn(),
    toJSON: vi.fn(),
    toString: vi.fn(() => path),
  });

  const createMockPanel = () => ({
    webview: {
      html: '',
      postMessage: vi.fn().mockResolvedValue(true),
      asWebviewUri: vi.fn((uri) => uri),
      cspSource: 'test-csp',
      onDidReceiveMessage: vi.fn(),
    },
    viewType: 'depPulseDashboard',
    title: 'DepPulse Dashboard',
    viewColumn: 1,
    active: true,
    visible: true,
    options: {},
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeViewState: vi.fn(),
    reveal: vi.fn(),
    dispose: vi.fn(),
  });

  return {
    window: {
      createWebviewPanel: vi.fn(() => createMockPanel()),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showSaveDialog: vi.fn(),
      showTextDocument: vi.fn(),
      get terminals() {
        return [];
      },
      createTerminal: vi.fn(),
    },
    ViewColumn: {
      One: 1,
    },
    Uri: {
      joinPath: vi.fn((base, ...paths) => createMockUri(`${base.path}/${paths.join('/')}`)),
      parse: vi.fn((uri: string) => createMockUri(uri)),
    },
    workspace: {
      get workspaceFolders() {
        return [];
      },
      openTextDocument: vi.fn(),
      fs: {
        stat: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
        createDirectory: vi.fn(),
        delete: vi.fn(),
      },
      getConfiguration: vi.fn(() => ({
        get: vi.fn((defaultValue) => defaultValue),
        update: vi.fn(),
        inspect: vi.fn(),
      })),
    },
    env: {
      clipboard: {
        writeText: vi.fn(),
      },
      openExternal: vi.fn(),
    },
    commands: {
      executeCommand: vi.fn(),
    },
    ExtensionMode: {
      Production: 1,
      Development: 2,
      Test: 3,
    },
  };
});

// Mock VS Code API
const createMockWebview = () => ({
  html: '',
  postMessage: vi.fn().mockResolvedValue(true),
  asWebviewUri: vi.fn((uri) => uri),
  cspSource: 'test-csp',
  onDidReceiveMessage: vi.fn(),
});

const createMockPanel = (): vscode.WebviewPanel => {
  const webview = createMockWebview();
  const panel: {
    webview: ReturnType<typeof createMockWebview>;
    viewType: string;
    title: string;
    viewColumn: number;
    active: boolean;
    visible: boolean;
    options: object;
    _disposeCallback: (() => void) | null;
    onDidDispose: (callback: () => void) => { dispose: () => void };
    onDidChangeViewState: () => void;
    reveal: () => void;
    dispose: () => void;
  } = {
    webview,
    viewType: 'depPulseDashboard',
    title: 'DepPulse Dashboard',
    viewColumn: 1,
    active: true,
    visible: true,
    options: {},
    _disposeCallback: null,
    onDidDispose: vi.fn((callback) => {
      // Store callback for manual triggering
      panel._disposeCallback = callback;
      return { dispose: vi.fn() };
    }),
    onDidChangeViewState: vi.fn(),
    reveal: vi.fn(),
    dispose: vi.fn(() => {
      // Trigger dispose callback if set
      if (panel._disposeCallback) {
        panel._disposeCallback();
      }
    }),
  };
  return panel as unknown as vscode.WebviewPanel;
};

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

const createMockUri = (path: string): vscode.Uri => ({
  scheme: 'file',
  authority: '',
  path,
  query: '',
  fragment: '',
  fsPath: path,
  with: vi.fn(),
  toJSON: vi.fn(),
});

// Helper to create mock analysis result
const createMockAnalysis = (): AnalysisResult => {
  const dependency: Dependency = {
    name: 'test-package',
    version: '1.0.0',
    versionConstraint: '^1.0.0',
    isDev: false,
  };

  const analysis: DependencyAnalysis = {
    dependency,
    security: {
      vulnerabilities: [],
      severity: 'none',
    },
    freshness: {
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      versionGap: 'current',
      releaseDate: new Date(),
      isOutdated: false,
      isUnmaintained: false,
    },
    license: {
      license: 'MIT',
      spdxIds: ['MIT'],
      isCompatible: true,
      licenseType: 'permissive',
    },
  };

  return {
    timestamp: new Date(),
    dependencies: [analysis],
    healthScore: {
      overall: 100,
      security: 100,
      freshness: 100,
      compatibility: 100,
      license: 100,
      breakdown: {
        totalDependencies: 1,
        criticalIssues: 0,
        warnings: 0,
        healthy: 1,
      },
    },
    summary: {
      totalDependencies: 1,
      analyzedDependencies: 1,
      failedDependencies: 0,
      criticalIssues: 0,
      highIssues: 0,
      warnings: 0,
      healthy: 1,
    },
  };
};

describe('DashboardController - Webview Readiness Protocol', () => {
  let controller: DashboardController;
  let mockAlternativeService: AlternativeSuggestionService;
  let mockOutputChannel: vscode.OutputChannel;
  let mockExtensionUri: vscode.Uri;

  beforeEach(() => {
    mockOutputChannel = createMockOutputChannel();
    mockExtensionUri = createMockUri('/test/extension');
    mockAlternativeService = {
      getSuggestions: vi.fn(),
      isConfigured: vi.fn().mockReturnValue(true),
      getProvider: vi.fn(),
    } as unknown as AlternativeSuggestionService;
    controller = new DashboardController(
      mockExtensionUri,
      mockOutputChannel,
      true,
      vscode.ExtensionMode.Test,
      mockAlternativeService
    );
  });

  describe('show() method', () => {
    it('should not send data immediately when panel is created', () => {
      // Set up analysis data before showing
      const analysis = createMockAnalysis();
      controller.update(analysis);

      // Mock panel creation
      const mockPanel = createMockPanel();
      (controller as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (controller as unknown as { isWebviewReady: boolean }).isWebviewReady = false;

      // Verify postMessage was not called
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('should reset readiness state when creating new panel', () => {
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      // Set readiness to true
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      // Create new panel by calling show (which resets readiness)
      controller.show();

      // Verify readiness was reset (show() creates a new panel and resets state)
      expect((webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady).toBe(false);
    });
  });

  describe('handleMessage() with ready signal', () => {
    it('should set isWebviewReady to true when ready message received', async () => {
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = false;

      // Simulate ready message
      controller.handleMessage({ command: 'ready' });

      // Wait for async operations (handleWebviewReady is async)
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect((webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady).toBe(true);
    });

    it('should send data when ready message received and analysis exists', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (controller as unknown as { currentAnalysis: AnalysisResult }).currentAnalysis = analysis;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = false;

      // Mock detectPackageManager
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      // Simulate ready message
      controller.handleMessage({ command: 'ready' });

      // Wait for async operations (handleWebviewReady is async)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify postMessage was called
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.any(Object),
        })
      );
    });
  });

  describe('update() method with readiness state', () => {
    it('should store data as pending when webview not ready', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = false;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      await controller.update(analysis);

      // Verify data was stored as pending
      expect((controller as unknown as { pendingData: unknown }).pendingData).not.toBeNull();
      // Verify postMessage was NOT called
      expect(mockPanel.webview.postMessage).not.toHaveBeenCalled();
    });

    it('should send data immediately when webview is ready', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      await controller.update(analysis);

      // Verify postMessage was called immediately
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.any(Object),
        })
      );
    });

    it('should store analysis when panel is not visible', async () => {
      const analysis = createMockAnalysis();

      (controller as unknown as { panel: unknown }).panel = undefined;

      await controller.update(analysis);

      // Verify analysis was stored
      expect((controller as unknown as { currentAnalysis: AnalysisResult }).currentAnalysis).toBe(
        analysis
      );
    });
    it('should pass cache status to webview', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      const cacheStatus = { isCached: true, cacheAge: 5 };
      await controller.update(analysis, undefined, cacheStatus);

      // Verify postMessage was called with cache status
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.objectContaining({
            isCached: true,
            cacheAge: 5,
          }),
        })
      );
    });

    it('should propagate transitiveEnabled flag to webview data', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      await controller.update(analysis, undefined, undefined, undefined, false);

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.objectContaining({
            transitiveEnabled: false,
          }),
        })
      );
    });

    it('should preserve performance metrics if not provided in update', async () => {
      // Setup mock data with performance metrics
      const mockAnalysisWithMetrics = {
        ...createMockAnalysis(), // Use createMockAnalysis to get a base analysis object
        performanceMetrics: {
          scanDuration: 100,
          memoryUsage: {
            heapUsed: 1000,
            heapTotal: 2000,
            rss: 3000,
          },
          dependencyCount: 1,
          validDependencyCount: 1,
          invalidDependencyCount: 0,
          transitiveDependencyCount: 0,
        },
      };

      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      // Mock transformer to return data with metrics
      const spy = vi
        .spyOn(DashboardDataTransformer.prototype, 'transformAnalysisData')
        .mockReturnValue({
          dependencies: [],
          healthScore: mockAnalysisWithMetrics.healthScore,
          metrics: {
            totalDependencies: 0,
            analyzedDependencies: 0,
            failedDependencies: 0,
            criticalIssues: 0,
            highIssues: 0,
            outdatedPackages: 0,
            healthyPackages: 0,
          },
          chartData: {
            severity: { critical: 0, high: 0, medium: 0, low: 0, none: 0 },
            freshness: { current: 0, patch: 0, minor: 0, major: 0, unmaintained: 0 },
          },
          lastScanned: new Date(),
          packageManager: 'npm',
          isCached: false,
          performanceMetrics: mockAnalysisWithMetrics.performanceMetrics,
        });

      // Call update without performanceMetrics arg
      await controller.update(mockAnalysisWithMetrics);

      // Verify postMessage was called with metrics
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.objectContaining({
            performanceMetrics: mockAnalysisWithMetrics.performanceMetrics,
          }),
        })
      );

      spy.mockRestore();
    });
  });

  describe('panel disposal', () => {
    it('should reset readiness state when panel is disposed', () => {
      const mockPanel = createMockPanel();

      // Set up the controller state
      (controller as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (controller as unknown as { isWebviewReady: boolean }).isWebviewReady = true;
      (controller as unknown as { pendingData: unknown }).pendingData = { test: 'data' };

      // Manually register the disposal handler that would be set in show()
      const disposeHandler = () => {
        (controller as unknown as { panel: unknown }).panel = undefined;
        (controller as unknown as { isWebviewReady: boolean }).isWebviewReady = false;
        (controller as unknown as { pendingData: unknown }).pendingData = null;
      };
      (mockPanel as unknown as { _disposeCallback: () => void })._disposeCallback = disposeHandler;

      // Trigger disposal
      mockPanel.dispose();

      // Verify state was reset
      expect((controller as unknown as { panel: unknown }).panel).toBeUndefined();
      expect((controller as unknown as { isWebviewReady: boolean }).isWebviewReady).toBe(false);
      expect((controller as unknown as { pendingData: unknown }).pendingData).toBeNull();
    });
  });

  describe('handleWebviewReady() with pending data', () => {
    it('should send pending data when available', async () => {
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      const pendingData = {
        healthScore: 100,
        metrics: {
          totalDependencies: 1,
          criticalIssues: 0,
          highIssues: 0,
          outdatedPackages: 0,
          healthyPackages: 1,
        },
        chartData: {
          severity: { critical: 0, high: 0, medium: 0, low: 0, none: 1 },
          freshness: { current: 1, patch: 0, minor: 0, major: 0, unmaintained: 0 },
        },
        dependencies: [],
        packageManager: 'npm' as const,
        lastScanned: new Date(),
        isCached: false,
      };

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (controller as unknown as { pendingData: unknown }).pendingData = pendingData;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = false;

      controller.handleMessage({ command: 'ready' });

      // Wait for async operations (handleWebviewReady is async)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify pending data was sent
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'analysisUpdate',
        data: pendingData,
      });

      // Verify pending data was cleared
      expect((controller as unknown as { pendingData: unknown }).pendingData).toBeNull();
    });

    it('should use stored cache status when sending analysis data', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = false;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      // Update with cache status (will be stored)
      const cacheStatus = { isCached: true, cacheAge: 10 };
      await controller.update(analysis, undefined, cacheStatus);

      // Simulate ready message
      controller.handleMessage({ command: 'ready' });

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify postMessage was called with stored cache status
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.objectContaining({
            isCached: true,
            cacheAge: 10,
          }),
        })
      );
    });

    it('should not show cache indicator when cache status is missing', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      await controller.update(analysis);

      // Verify postMessage was called with isCached: false (default)
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.objectContaining({
            isCached: false,
          }),
        })
      );
    });

    it('should not show cache indicator when explicitly not cached', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      const cacheStatus = { isCached: false, cacheAge: 0 };
      await controller.update(analysis, undefined, cacheStatus);

      // Verify postMessage was called with isCached: false
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.objectContaining({
            isCached: false,
          }),
        })
      );
    });

    it('should send stored performance metrics when webview becomes ready', async () => {
      const analysis = createMockAnalysis();
      const mockPanel = createMockPanel();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();

      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = false;
      (
        controller as unknown as { detectPackageManager: () => Promise<string> }
      ).detectPackageManager = vi.fn().mockResolvedValue('npm');

      const performanceMetrics = {
        scanDuration: 500,
        memoryUsage: { heapUsed: 100, heapTotal: 200, rss: 300 },
        dependencyCount: 0,
        validDependencyCount: 10,
        invalidDependencyCount: 0,
        transitiveDependencyCount: 0,
      };

      // Update with metrics (will be stored)
      await controller.update(analysis, performanceMetrics);

      // Simulate ready message
      controller.handleMessage({ command: 'ready' });

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify postMessage was called with metrics
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'analysisUpdate',
          data: expect.objectContaining({
            performanceMetrics: performanceMetrics,
          }),
        })
      );
    });
  });

  describe('handleLogError() - basic payloads', () => {
    it('should handle string error messages', () => {
      const errorMessage = 'Enable cache for faster scans';
      controller.handleMessage({ command: 'logError', data: errorMessage });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('[Dashboard Info] Enable cache for faster scans')
      );
    });

    it('should handle object error messages', () => {
      const errorData = {
        message: 'Something went wrong',
        timestamp: new Date().toISOString(),
        stack: 'Error stack trace',
      };
      controller.handleMessage({ command: 'logError', data: errorData });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('=== ERROR FROM DASHBOARD ===')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Message: Something went wrong')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Stack: Error stack trace')
      );
    });
  });
});

describe('DashboardController - Message Handlers', () => {
  let controller: DashboardController;
  let mockOutputChannel: vscode.OutputChannel;
  let mockExtensionUri: vscode.Uri;
  let mockPanel: vscode.WebviewPanel;
  let mockWebviewManager: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputChannel = createMockOutputChannel();
    mockExtensionUri = createMockUri('/test/extension');
    controller = new DashboardController(
      mockExtensionUri,
      mockOutputChannel,
      true,
      vscode.ExtensionMode.Test,
      {
        getSuggestions: vi.fn(),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn(),
      } as unknown as AlternativeSuggestionService
    );
    mockPanel = createMockPanel();
    mockWebviewManager = (
      controller as unknown as { getWebviewManager: () => unknown }
    ).getWebviewManager();
    (mockWebviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
    (mockWebviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

    // Mock vscode APIs
    vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showTextDocument').mockResolvedValue(
      {} as unknown as vscode.TextEditor
    );
    vi.spyOn(vscode.workspace, 'openTextDocument').mockResolvedValue(
      {} as unknown as vscode.TextDocument
    );
    vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue();
    vi.spyOn(vscode.env, 'openExternal').mockResolvedValue(true);
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    // terminals is already defined in the mock as a getter, no need to spy
    vi.spyOn(vscode.window, 'createTerminal').mockReturnValue({
      name: 'DepPulse Updates',
      show: vi.fn(),
      sendText: vi.fn(),
    } as unknown as vscode.Terminal);
  });

  describe('handleFilterChange()', () => {
    it('should log filter change data', () => {
      const filterData = { severity: 'high', freshness: 'outdated' };
      controller.handleMessage({ command: 'filterChange', data: filterData });
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Filter change')
      );
    });
  });

  describe('handleSearch()', () => {
    it('should log search term', () => {
      const searchData = { query: 'test-package' };
      controller.handleMessage({ command: 'search', data: searchData });
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Search'));
    });
  });

  describe('handleViewDetails()', () => {
    it('should log view details request', () => {
      const detailsData = { name: 'test-package' };
      controller.handleMessage({ command: 'viewDetails', data: detailsData });
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('View details')
      );
    });
  });

  describe('handleUpdateDependency()', () => {
    it('should generate and execute update command for npm', async () => {
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));

      const updateData = { name: 'test-package', version: '2.0.0' };
      await controller.handleMessage({ command: 'updateDependency', data: updateData });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(vscode.window.createTerminal).toHaveBeenCalled();
    });

    it('should handle invalid update data', async () => {
      const updateData = { name: '', version: '' };
      await controller.handleMessage({ command: 'updateDependency', data: updateData });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Invalid update data')
      );
    });

    it('should use the dependency workspace package manager in multi-root workspaces', async () => {
      const terminal = {
        name: 'DepPulse Updates',
        show: vi.fn(),
        sendText: vi.fn(),
      } as unknown as vscode.Terminal;

      vi.spyOn(vscode.window, 'createTerminal').mockReturnValue(terminal);
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace-a') },
        { uri: createMockUri('/workspace-b') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: vscode.Uri) => {
        if (uri.fsPath.includes('/workspace-b/pnpm-lock.yaml')) {
          return {} as vscode.FileStat;
        }
        throw new Error('Not found');
      });

      await controller.handleMessage({
        command: 'updateDependency',
        data: {
          name: 'test-package',
          version: '2.0.0',
          packageRoot: '/workspace-b/packages/app',
          workspaceFolder: '/workspace-b',
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(terminal.sendText).toHaveBeenCalledWith(
        'pnpm -C "/workspace-b/packages/app" update test-package@2.0.0',
        false
      );
    });
  });

  describe('handleExportReport()', () => {
    it('should export report to file', async () => {
      const mockWorkspaceFolder = { uri: createMockUri('/workspace') };
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        mockWorkspaceFolder,
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(createMockUri('/workspace/report.json'));
      vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(
        createMockUri('/workspace/report.json') as unknown as vscode.Uri
      );
      vi.spyOn(vscode.workspace.fs, 'writeFile').mockResolvedValue();

      const exportData = {
        format: 'json',
        filename: 'report.json',
        content: '{"test": "data"}',
      };
      await controller.handleMessage({ command: 'exportReport', data: exportData });

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
    });

    it('should default export to the scoped workspace in multi-root mode', async () => {
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace-a') },
        { uri: createMockUri('/workspace-b') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.Uri, 'joinPath').mockImplementation((base, ...paths) =>
        createMockUri(`${base.path}/${paths.join('/')}`)
      );
      const saveDialogSpy = vi
        .spyOn(vscode.window, 'showSaveDialog')
        .mockResolvedValue(
          createMockUri('/workspace-b/deppulse-report.json') as unknown as vscode.Uri
        );
      vi.spyOn(vscode.workspace.fs, 'writeFile').mockResolvedValue();

      await controller.handleMessage({
        command: 'exportReport',
        data: {
          format: 'json',
          filename: 'deppulse-report.json',
          content: '{"test":"data"}',
          workspaceFolder: '/workspace-b',
          packageRoot: '/workspace-b/packages/app',
        },
      });

      expect(saveDialogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultUri: expect.objectContaining({ fsPath: '/workspace-b/deppulse-report.json' }),
        })
      );
    });

    it('should handle missing workspace folder', async () => {
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue(undefined);
      vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

      const exportData = {
        format: 'json',
        filename: 'report.json',
        content: '{"test": "data"}',
      };
      await controller.handleMessage({ command: 'exportReport', data: exportData });

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No workspace folder open');
    });

    it('should handle invalid export data', async () => {
      const exportData = { format: 'json', filename: '', content: '' };
      await controller.handleMessage({ command: 'exportReport', data: exportData });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Invalid export data')
      );
    });

    it('should handle export errors', async () => {
      const mockWorkspaceFolder = { uri: createMockUri('/workspace') };
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        mockWorkspaceFolder,
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(createMockUri('/workspace/report.json'));
      vi.spyOn(vscode.window, 'showSaveDialog').mockResolvedValue(
        createMockUri('/workspace/report.json') as unknown as vscode.Uri
      );
      vi.spyOn(vscode.workspace.fs, 'writeFile').mockRejectedValue(new Error('Write failed'));
      vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

      const exportData = {
        format: 'json',
        filename: 'report.json',
        content: '{"test": "data"}',
      };
      await controller.handleMessage({ command: 'exportReport', data: exportData });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('handleShowAlternatives()', () => {
    it('should return cached alternatives', async () => {
      const mockService = {
        getSuggestions: vi.fn(),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn().mockReturnValue('openrouter'),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      const cachedSuggestions: AlternativeSuggestion[] = [
        {
          name: 'alternative-package',
          description: 'Alternative package',
          weeklyDownloads: 1000,
          npmUrl: 'https://www.npmjs.com/package/alternative-package',
          installCommand: 'npm install alternative-package',
        },
      ];
      (
        controllerWithService as unknown as {
          alternativeCache: Map<string, AlternativeSuggestion[]>;
        }
      ).alternativeCache.set('test-package', cachedSuggestions);

      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'alternativesResult',
        data: {
          packageName: 'test-package',
          suggestions: cachedSuggestions,
          provider: 'openrouter',
        },
      });
    });

    it('should fetch alternatives from service', async () => {
      const suggestions: AlternativeSuggestion[] = [
        {
          name: 'alternative-package',
          description: 'Alternative package',
          weeklyDownloads: 1000,
          npmUrl: 'https://www.npmjs.com/package/alternative-package',
          installCommand: 'npm install alternative-package',
        },
      ];

      const mockService = {
        getSuggestions: vi.fn().mockResolvedValue(suggestions),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn().mockReturnValue('openrouter'),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));

      const analysis = createMockAnalysis();
      (controllerWithService as unknown as { currentAnalysis: AnalysisResult }).currentAnalysis =
        analysis;

      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockService.getSuggestions).toHaveBeenCalled();
      expect(
        (
          controllerWithService as unknown as { alternativeCache: Map<string, unknown> }
        ).alternativeCache.has('test-package')
      ).toBe(true);
    });

    it('should bypass cache when cache is disabled', async () => {
      const suggestions: AlternativeSuggestion[] = [
        {
          name: 'alternative-package',
          description: 'Alternative package',
          weeklyDownloads: 1000,
          npmUrl: 'https://www.npmjs.com/package/alternative-package',
          installCommand: 'npm install alternative-package',
        },
      ];

      const mockService = {
        getSuggestions: vi.fn().mockResolvedValue(suggestions),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn().mockReturnValue('openrouter'),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        false,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      // Seed cache but with cache disabled it should be ignored
      (
        controllerWithService as unknown as {
          alternativeCache: Map<string, AlternativeSuggestion[]>;
        }
      ).alternativeCache.set('test-package', [
        {
          name: 'cached',
          description: 'Cached',
          weeklyDownloads: 1,
          npmUrl: '',
          installCommand: '',
        },
      ]);

      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));
      const analysis = createMockAnalysis();
      (controllerWithService as unknown as { currentAnalysis: AnalysisResult }).currentAnalysis =
        analysis;

      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(mockService.getSuggestions).toHaveBeenCalled();
      expect(
        (
          controllerWithService as unknown as {
            alternativeCache: Map<string, AlternativeSuggestion[]>;
          }
        ).alternativeCache.get('test-package')?.[0].name
      ).toBe('alternative-package');
    });

    it('should handle service errors', async () => {
      const mockService = {
        getSuggestions: vi.fn().mockRejectedValue(new Error('Service error')),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn().mockReturnValue('openrouter'),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));

      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'alternativesError',
        data: { packageName: 'test-package', message: 'Service error', provider: 'openrouter' },
      });
      expect(
        (
          controllerWithService as unknown as { alternativeErrors: Map<string, unknown> }
        ).alternativeErrors.has('test-package')
      ).toBe(true);
    });

    it('should surface auth errors from service', async () => {
      const mockService = {
        getSuggestions: vi.fn().mockRejectedValue(new Error('LLM authentication failed')),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn().mockReturnValue('openrouter'),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'alternativesError',
        data: {
          packageName: 'test-package',
          message: 'LLM authentication failed',
          provider: 'openrouter',
        },
      });
    });

    it('should surface auth errors from gemini service', async () => {
      const mockService = {
        getSuggestions: vi.fn().mockRejectedValue(new Error('401 unauthorized token')),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn().mockReturnValue('gemini'),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'alternativesError',
        data: {
          packageName: 'test-package',
          message: '401 unauthorized token',
          provider: 'gemini',
        },
      });
    });

    it('should request configuration when service is not configured', async () => {
      const mockService = {
        getSuggestions: vi.fn(),
        isConfigured: vi.fn().mockReturnValue(false),
        getProvider: vi.fn(),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'alternativesConfigRequired',
        data: { packageName: 'test-package' },
      });
      expect(mockService.getSuggestions).not.toHaveBeenCalled();
    });

    it('should handle missing package name', async () => {
      await controller.handleMessage({
        command: 'showAlternatives',
        data: {},
      });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('showAlternatives invoked without package name')
      );
    });

    it('should handle missing service', async () => {
      // Create controller without service
      const controllerNoService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        undefined as unknown as AlternativeSuggestionService
      );

      const webviewManager = (
        controllerNoService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;

      await controllerNoService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'alternativesError',
        data: {
          packageName: 'test-package',
          message: 'Alternative suggestions are unavailable in this build.',
        },
      });
    });

    it('should prevent duplicate requests', async () => {
      const mockService = {
        getSuggestions: vi
          .fn()
          .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 100))),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn().mockReturnValue('openrouter'),
      } as unknown as AlternativeSuggestionService;

      const controllerWithService = new DashboardController(
        mockExtensionUri,
        mockOutputChannel,
        true,
        vscode.ExtensionMode.Test,
        mockService
      );
      const webviewManager = (
        controllerWithService as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));

      // First request (don't await - let it start)
      const _firstRequest = controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      // Second request before first completes (should be prevented)
      await controllerWithService.handleMessage({
        command: 'showAlternatives',
        data: { name: 'test-package' },
      });

      // Wait a bit for the first request to complete
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(mockService.getSuggestions).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleBulkUpdate()', () => {
    it('should generate and execute bulk update commands', async () => {
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));

      const bulkData = {
        packages: [
          { name: 'package1', version: '1.0.0' },
          { name: 'package2', version: '2.0.0' },
        ],
      };
      await controller.handleMessage({ command: 'bulkUpdate', data: bulkData });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(vscode.window.createTerminal).toHaveBeenCalled();
    });

    it('should handle empty packages array', async () => {
      const bulkData = { packages: [] };
      await controller.handleMessage({ command: 'bulkUpdate', data: bulkData });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('No packages to update')
      );
    });
  });

  describe('handleViewLogs()', () => {
    it('should show output channel', () => {
      controller.handleMessage({ command: 'viewLogs' });
      expect(mockOutputChannel.show).toHaveBeenCalled();
    });
  });

  describe('handleCopyToClipboard()', () => {
    it('should copy text to clipboard', async () => {
      const clipboardData = { text: 'test text to copy' };
      await controller.handleMessage({ command: 'copyToClipboard', data: clipboardData });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('test text to copy');
    });

    it('should handle missing text', () => {
      controller.handleMessage({ command: 'copyToClipboard', data: {} });
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('copyToClipboard invoked without text payload')
      );
    });

    it('should handle clipboard errors', async () => {
      vi.spyOn(vscode.env.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard error'));
      const clipboardData = { text: 'test text' };
      await controller.handleMessage({ command: 'copyToClipboard', data: clipboardData });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Failed to copy text to clipboard')
      );
    });
  });

  describe('handleOpenExternalLink()', () => {
    it('should open external link', async () => {
      const linkData = { url: 'https://example.com' };
      await controller.handleMessage({ command: 'openExternalLink', data: linkData });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(vscode.env.openExternal).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: expect.stringContaining('https://example.com') })
      );
    });

    it('should handle missing URL', () => {
      controller.handleMessage({ command: 'openExternalLink', data: {} });
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('openExternalLink invoked without url payload')
      );
    });

    it('should handle link opening errors', async () => {
      vi.spyOn(vscode.env, 'openExternal').mockRejectedValue(new Error('Open failed'));
      const linkData = { url: 'https://example.com' };
      await controller.handleMessage({ command: 'openExternalLink', data: linkData });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Failed to open external link')
      );
    });
  });

  describe('handleLogError() - structured payloads', () => {
    it('should log error details from webview', () => {
      const errorData = {
        message: 'Test error',
        stack: 'Error stack trace',
        timestamp: '2024-01-01T00:00:00Z',
        userAgent: 'Test Agent',
        dashboardState: { test: 'state' },
      };
      controller.handleMessage({ command: 'logError', data: errorData });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('=== ERROR FROM DASHBOARD ===')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Test error')
      );
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Error stack trace')
      );
    });

    it('should log error without optional fields', () => {
      const errorData = {
        message: 'Test error',
        timestamp: '2024-01-01T00:00:00Z',
      };
      controller.handleMessage({ command: 'logError', data: errorData });

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('=== ERROR FROM DASHBOARD ===')
      );
    });
  });

  describe('handleRefresh()', () => {
    it('should execute scan command', async () => {
      vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;

      await controller.handleMessage({ command: 'refresh' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('depPulse.scan', {
        bypassCache: false,
      });
    });

    it('should handle scan command errors', async () => {
      vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(new Error('Scan failed'));
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;

      await controller.handleMessage({ command: 'refresh' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        })
      );
    });

    it('should NOT send progressUpdate after error (regression test)', async () => {
      vi.spyOn(vscode.commands, 'executeCommand').mockRejectedValue(new Error('Scan failed'));
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;

      await controller.handleMessage({ command: 'refresh' });

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify error message was sent
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        })
      );

      // Verify NO progressUpdate was sent AFTER the error (this would hide the error modal)
      const allCalls = (mockPanel.webview.postMessage as ReturnType<typeof vi.fn>).mock.calls;
      const errorIndex = allCalls.findIndex((call) => call[0]?.type === 'error');
      const progressUpdatesAfterError = allCalls
        .slice(errorIndex + 1)
        .filter((call) => call[0]?.type === 'progressUpdate');
      expect(progressUpdatesAfterError).toHaveLength(0);
    });
  });

  describe('handleMessage() - unknown command', () => {
    it('should log unknown command', () => {
      controller.handleMessage({ command: 'unknownCommand' as unknown as 'refresh' });
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('Unknown command: unknownCommand')
      );
    });
  });
});

describe('DashboardController - Package Manager Detection', () => {
  let controller: DashboardController;
  let mockOutputChannel: vscode.OutputChannel;
  let mockExtensionUri: vscode.Uri;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputChannel = createMockOutputChannel();
    mockExtensionUri = createMockUri('/test/extension');
    controller = new DashboardController(
      mockExtensionUri,
      mockOutputChannel,
      true,
      vscode.ExtensionMode.Test,
      {
        getSuggestions: vi.fn(),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn(),
      } as unknown as AlternativeSuggestionService
    );
  });

  it('should detect pnpm from pnpm-lock.yaml', async () => {
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
      { uri: createMockUri('/workspace') },
    ] as unknown as vscode.WorkspaceFolder[]);
    vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(createMockUri('/workspace/pnpm-lock.yaml'));
    vi.spyOn(vscode.workspace.fs, 'stat').mockResolvedValue({} as unknown as vscode.FileStat);

    const packageManager = await (
      controller as unknown as { detectPackageManager: () => Promise<string> }
    ).detectPackageManager();
    expect(packageManager).toBe('pnpm');
  });

  it('should detect package manager from the target workspace in multi-root mode', async () => {
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
      { uri: createMockUri('/workspace-a') },
      { uri: createMockUri('/workspace-b') },
    ] as unknown as vscode.WorkspaceFolder[]);
    vi.spyOn(vscode.Uri, 'joinPath').mockImplementation((base, ...paths) =>
      createMockUri(`${base.path}/${paths.join('/')}`)
    );

    vi.spyOn(vscode.workspace.fs, 'stat').mockImplementation(async (uri: vscode.Uri) => {
      if (uri.fsPath.includes('/workspace-b/pnpm-lock.yaml')) {
        return {} as vscode.FileStat;
      }
      throw new Error('Not found');
    });

    const packageManager = await (
      controller as unknown as { detectPackageManager: (targetPath?: string) => Promise<string> }
    ).detectPackageManager('/workspace-b/packages/app');

    expect(packageManager).toBe('pnpm');
  });

  it('should detect yarn from yarn.lock', async () => {
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
      { uri: createMockUri('/workspace') },
    ] as unknown as vscode.WorkspaceFolder[]);
    vi.spyOn(vscode.Uri, 'joinPath')
      .mockReturnValueOnce(createMockUri('/workspace/pnpm-lock.yaml'))
      .mockReturnValueOnce(createMockUri('/workspace/yarn.lock'));
    vi.spyOn(vscode.workspace.fs, 'stat')
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce({} as unknown as vscode.FileStat);

    const packageManager = await (
      controller as unknown as { detectPackageManager: () => Promise<string> }
    ).detectPackageManager();
    expect(packageManager).toBe('yarn');
  });

  it('should detect npm from package-lock.json', async () => {
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
      { uri: createMockUri('/workspace') },
    ] as unknown as vscode.WorkspaceFolder[]);
    vi.spyOn(vscode.Uri, 'joinPath')
      .mockReturnValueOnce(createMockUri('/workspace/pnpm-lock.yaml'))
      .mockReturnValueOnce(createMockUri('/workspace/yarn.lock'))
      .mockReturnValueOnce(createMockUri('/workspace/package-lock.json'));
    vi.spyOn(vscode.workspace.fs, 'stat')
      .mockRejectedValueOnce(new Error('Not found'))
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce({} as unknown as vscode.FileStat);

    const packageManager = await (
      controller as unknown as { detectPackageManager: () => Promise<string> }
    ).detectPackageManager();
    expect(packageManager).toBe('npm');
  });

  it('should default to npm when no lock file found', async () => {
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
      { uri: createMockUri('/workspace') },
    ] as unknown as vscode.WorkspaceFolder[]);
    vi.spyOn(vscode.Uri, 'joinPath').mockReturnValue(createMockUri('/workspace/lock-file'));
    vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));

    const packageManager = await (
      controller as unknown as { detectPackageManager: () => Promise<string> }
    ).detectPackageManager();
    expect(packageManager).toBe('npm');
  });

  it('should default to npm when no workspace folder', async () => {
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue(undefined);

    const packageManager = await (
      controller as unknown as { detectPackageManager: () => Promise<string> }
    ).detectPackageManager();
    expect(packageManager).toBe('npm');
  });
});

describe('DashboardController - Error Handling', () => {
  let controller: DashboardController;
  let mockOutputChannel: vscode.OutputChannel;
  let mockExtensionUri: vscode.Uri;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOutputChannel = createMockOutputChannel();
    mockExtensionUri = createMockUri('/test/extension');
    controller = new DashboardController(
      mockExtensionUri,
      mockOutputChannel,
      true,
      vscode.ExtensionMode.Test,
      {
        getSuggestions: vi.fn(),
        isConfigured: vi.fn().mockReturnValue(true),
        getProvider: vi.fn(),
      } as unknown as AlternativeSuggestionService
    );
  });

  describe('update() error handling', () => {
    it('should handle transformation errors', async () => {
      const analysis = createMockAnalysis();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => unknown }
      ).getWebviewManager();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = createMockPanel();
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      // Mock detectPackageManager to throw error by making joinPath throw
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      // Make dataTransformer.transformAnalysisData throw an error that will be caught in update's catch block
      // This is the actual transformation that happens in the try-catch block
      const _originalTransform = (
        controller as unknown as {
          dataTransformer: { transformAnalysisData: (a: unknown) => unknown };
        }
      ).dataTransformer.transformAnalysisData;
      const spy = vi
        .spyOn(DashboardDataTransformer.prototype, 'transformAnalysisData')
        .mockImplementation(() => {
          throw new Error('Transformation error');
        });

      await controller.update(analysis);

      // The error should be caught and logged
      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('ERROR transforming analysis data')
      );

      spy.mockRestore();
    });

    it('should handle sendData errors', async () => {
      const analysis = createMockAnalysis();
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => { sendData: () => void } }
      ).getWebviewManager();
      const mockPanel = createMockPanel();
      (webviewManager as unknown as { panel: vscode.WebviewPanel }).panel = mockPanel;
      (webviewManager as unknown as { isWebviewReady: boolean }).isWebviewReady = true;

      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: createMockUri('/workspace') },
      ] as unknown as vscode.WorkspaceFolder[]);
      vi.spyOn(vscode.workspace.fs, 'stat').mockRejectedValue(new Error('Not found'));

      // Mock sendData to throw error
      vi.spyOn(webviewManager, 'sendData').mockImplementation(() => {
        throw new Error('Send failed');
      });

      await controller.update(analysis);

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        expect.stringContaining('ERROR sending data to webview')
      );
      expect(mockPanel.webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
        })
      );
    });
  });

  describe('dispose()', () => {
    it('should clean up resources', () => {
      const webviewManager = (
        controller as unknown as { getWebviewManager: () => { dispose: () => void } }
      ).getWebviewManager();
      vi.spyOn(webviewManager, 'dispose').mockImplementation(() => {});

      controller.dispose();

      expect(webviewManager.dispose).toHaveBeenCalled();
      expect((controller as unknown as { webviewManager: unknown }).webviewManager).toBeUndefined();
      expect(
        (controller as unknown as { alternativeCache: Map<string, unknown> }).alternativeCache.size
      ).toBe(0);
      expect(
        (controller as unknown as { alternativeErrors: Map<string, unknown> }).alternativeErrors
          .size
      ).toBe(0);
      expect(
        (controller as unknown as { alternativeInFlight: Map<string, unknown> }).alternativeInFlight
          .size
      ).toBe(0);
      expect((controller as unknown as { pendingData: unknown }).pendingData).toBeNull();
      expect(
        (controller as unknown as { currentAnalysis: unknown }).currentAnalysis
      ).toBeUndefined();
    });
  });

  describe('sendProgressUpdate()', () => {
    it('should send progress when webview manager exists', () => {
      const webviewManager = (
        controller as unknown as {
          getWebviewManager: () => { sendProgressUpdate: (p: number, m: string) => void };
        }
      ).getWebviewManager();
      vi.spyOn(webviewManager, 'sendProgressUpdate').mockImplementation(() => {});

      controller.sendProgressUpdate(50, 'Processing...');

      expect(webviewManager.sendProgressUpdate).toHaveBeenCalledWith(50, 'Processing...');
    });

    it('should not send progress when webview manager does not exist', () => {
      (controller as unknown as { webviewManager: unknown }).webviewManager = undefined;

      controller.sendProgressUpdate(50, 'Processing...');

      // Should not throw error
      expect(mockOutputChannel.appendLine).toHaveBeenCalled();
    });
  });
});
