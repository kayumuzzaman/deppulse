import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  getCurrentAnalysisStatus,
  isCacheEnabled,
  isScanningInProgress,
  type LlmConfigStatus,
} from '../extension';
import type {
  AlternativeSuggestion,
  AnalysisResult,
  DashboardController as IDashboardController,
  LLMProvider,
  PerformanceMetrics,
  WebviewMessage,
} from '../types';
import type { LLMAlternativeSuggestionService } from '../utils';
import { evaluateLlmConfig } from '../utils/LlmConfig';
import { type DashboardData, DashboardDataTransformer } from './DashboardDataTransformer';
import { DashboardWebviewManager } from './DashboardWebviewManager';

/**
 * Manages the DepPulse dashboard webview panel
 * Handles webview lifecycle, message passing, and content updates
 */
export class DashboardController implements IDashboardController {
  private webviewManager: DashboardWebviewManager | undefined;
  private dataTransformer: DashboardDataTransformer;
  private currentAnalysis: AnalysisResult | undefined;
  private currentCacheStatus: { isCached: boolean; cacheAge?: number } | undefined;
  private currentPerformanceMetrics?: PerformanceMetrics;
  private pendingData: DashboardData | null = null;
  private _transitiveEnabled: boolean = true;
  private alternativeCache = new Map<string, AlternativeSuggestion[]>();
  private alternativeErrors = new Map<string, string>();
  private alternativeInFlight = new Set<string>();
  private alternativeProviders = new Map<string, LLMProvider | undefined>();
  private alternativeErrorProviders = new Map<string, LLMProvider | undefined>();
  private readonly _extensionUri: vscode.Uri;
  private readonly _outputChannel: vscode.OutputChannel;
  private _isCacheEnabled: boolean;
  private readonly _extensionMode: vscode.ExtensionMode;
  private _alternativeService: LLMAlternativeSuggestionService;

  constructor(
    extensionUri: vscode.Uri,
    outputChannel: vscode.OutputChannel,
    isCacheEnabled: boolean,
    extensionMode: vscode.ExtensionMode,
    alternativeService: LLMAlternativeSuggestionService
  ) {
    this._extensionUri = extensionUri;
    this._outputChannel = outputChannel;
    this._isCacheEnabled = isCacheEnabled;
    this._extensionMode = extensionMode;
    this._alternativeService = alternativeService;

    // Initialize data transformer (lightweight, used for updates)
    this.dataTransformer = new DashboardDataTransformer((msg) => this.log(msg));

    // Defer webview manager creation until show() is called (lazy loading)
    // This saves memory and initialization time during extension activation

    this.log(
      `DashboardController initialized (webview will be created on-demand, cache: ${isCacheEnabled})`
    );
  }

  /**
   * Get or create the webview manager (lazy initialization)
   */
  private getWebviewManager(): DashboardWebviewManager {
    if (!this.webviewManager) {
      this.log('Creating webview manager on-demand');
      this.webviewManager = new DashboardWebviewManager(
        this._extensionUri,
        (msg) => this.log(msg),
        this._extensionMode
      );

      // Set up webview manager callbacks
      this.webviewManager.setMessageHandler((message) => this.handleMessage(message));
      this.webviewManager.setReadyCallback(() => this.handleWebviewReady());
    }
    return this.webviewManager;
  }

  /**
   * Show the dashboard webview panel
   * Creates a new panel if one doesn't exist, or reveals existing panel
   * Webview manager is created on-demand (lazy loading)
   */
  public show(): void {
    this.getWebviewManager().show();
  }

  /**
   * Returns true if the dashboard webview is currently visible
   */
  public isVisible(): boolean {
    const panel = this.webviewManager?.getPanel();
    return Boolean(panel?.visible);
  }

  /**
   * Swap the LLM alternatives service without tearing down the dashboard
   * Clears cached alternatives to avoid mixing providers
   */
  public updateAlternativeService(service: LLMAlternativeSuggestionService): void {
    this._alternativeService = service;
    this.alternativeCache.clear();
    this.alternativeErrors.clear();
    this.alternativeInFlight.clear();
    this.alternativeProviders.clear();
    this.alternativeErrorProviders.clear();
    this.log('Alternative suggestion service replaced; caches cleared');

    // Inform webview to clear its local alternative tab state so UI reflects new config
    this.sendMessage({ type: 'alternativesReset' });
  }

  /**
   * Notify webview about LLM config changes so it can refresh error/empty states
   */
  public notifyLlmConfigChanged(status: LlmConfigStatus): void {
    this.sendMessage({ type: 'alternativesConfigChanged', data: status });
  }

  /**
   * Hide the dashboard webview panel
   */
  public hide(): void {
    if (this.webviewManager) {
      this.webviewManager.hide();
    }
  }

  /**
   * Update the dashboard with new analysis results
   * @param analysis The analysis results to display
   * @param performanceMetrics Optional performance metrics (scan time, memory usage)
   */
  public async update(
    analysis: AnalysisResult,
    performanceMetrics?: PerformanceMetrics,
    cacheStatus?: { isCached: boolean; cacheAge?: number },
    cacheEnabled?: boolean,
    transitiveEnabled?: boolean
  ): Promise<void> {
    this.currentAnalysis = analysis;
    this.currentCacheStatus = cacheStatus;
    if (performanceMetrics) {
      this.currentPerformanceMetrics = performanceMetrics;
    }
    if (cacheEnabled !== undefined) {
      this._isCacheEnabled = cacheEnabled;
    }
    this._transitiveEnabled = transitiveEnabled ?? true;

    this.log(
      `Dashboard update requested with ${analysis.dependencies.length} dependencies (Cached: ${
        cacheStatus?.isCached ?? false
      }, Age: ${cacheStatus?.cacheAge ?? 'N/A'}, Enabled: ${cacheEnabled ?? 'Unknown'})`
    );

    // Send update to webview if panel is visible
    // Only get webview manager if it exists (lazy loading)
    if (!this.webviewManager) {
      this.log('Dashboard panel not created yet, analysis stored for later display');
      return;
    }

    const panel = this.webviewManager.getPanel();
    if (!panel) {
      this.log('Dashboard panel not visible, analysis stored for later display');
      return;
    }

    // Always prepare the data (we'll send it if ready, or store it if not)
    let dashboardData: DashboardData;
    try {
      const packageManager = await this.detectPackageManager();
      this.log(`Detected package manager: ${packageManager}`);

      // Transform analysis data to dashboard format
      dashboardData = this.dataTransformer.transformAnalysisData(analysis, {
        transitiveEnabled: this._transitiveEnabled,
      });
      dashboardData.packageManager = packageManager;
      if (performanceMetrics) {
        this.log(`Including performance metrics: ${JSON.stringify(performanceMetrics)}`);
        dashboardData.performanceMetrics = performanceMetrics;
      }
      dashboardData.cacheEnabled = cacheEnabled;
      dashboardData.transitiveEnabled = this._transitiveEnabled;

      // Set cache status if provided
      if (cacheStatus) {
        dashboardData.isCached = cacheStatus.isCached;
        dashboardData.cacheAge = cacheStatus.cacheAge;
      }

      this.log(
        `Transformed data: ${dashboardData.dependencies.length} dependencies, health score: ${dashboardData.healthScore.overall}`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`ERROR transforming analysis data: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        this.log(`Stack trace: ${error.stack}`);
      }
      return;
    }

    // Check if webview is ready to receive data
    if (!this.webviewManager || !this.webviewManager.isReady()) {
      this.log('Webview not ready yet, storing data as pending');
      this.pendingData = dashboardData;
      return;
    }

    // Webview is ready, send data immediately
    try {
      this.log('Sending data to ready webview...');
      this.webviewManager.sendData(dashboardData);
      this.log('Dashboard update message sent to webview');
    } catch (error) {
      this.log(`ERROR sending data to webview: ${error}`);
      if (error instanceof Error && error.stack) {
        this.log(`Stack trace: ${error.stack}`);
      }

      // Try to send error message to webview
      if (!this.webviewManager) {
        return;
      }
      const errorPanel = this.webviewManager.getPanel();
      if (errorPanel) {
        errorPanel.webview.postMessage({
          type: 'error',
          data: {
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  /**
   * Send a generic message to the webview
   * @param message Message object to send
   */
  public sendMessage(message: { type: string; data?: unknown }): void {
    const panel = this.webviewManager?.getPanel();
    if (panel) {
      this.log(
        `Sending message to webview: ${message.type} ${
          message.type === 'cacheStatusChanged' &&
          message.data &&
          typeof message.data === 'object' &&
          'enabled' in message.data
            ? `(enabled=${(message.data as { enabled: boolean }).enabled})`
            : ''
        }`
      );
      panel.webview.postMessage(message);
    } else {
      this.log(`Cannot send message ${message.type}: Webview not available`);
    }
  }

  /**
   * Handle messages received from the webview
   * @param message The message from the webview
   */
  public handleMessage(message: WebviewMessage): void {
    this.log(`Received message from webview: ${message.command}`);

    switch (message.command) {
      case 'ready':
        this.handleWebviewReady();
        break;

      case 'refresh': {
        // Don't await - let it run in background
        // Extract force flag if present
        const refreshData = message.data as { force?: boolean };
        this.handleRefresh(refreshData?.force).catch((error) => {
          this.log(`Error in handleRefresh: ${error}`);
        });
        break;
      }

      case 'filterChange':
        this.handleFilterChange(message.data);
        break;

      case 'search':
        this.handleSearch(message.data);
        break;

      case 'viewDetails':
        this.handleViewDetails(message.data);
        break;

      case 'updateDependency':
        this.handleUpdateDependency(message.data);
        break;

      case 'exportReport':
        this.handleExportReport(message.data);
        break;

      case 'showAlternatives':
        this.handleShowAlternatives(message.data).catch((error) => {
          this.log(`Error handling showAlternatives: ${error}`);
        });
        break;

      case 'bulkUpdate':
        this.handleBulkUpdate(message.data);
        break;

      case 'viewLogs':
        this.handleViewLogs();
        break;

      case 'logError':
        this.handleLogError(message.data);
        break;

      case 'copyToClipboard':
        this.handleCopyToClipboard(message.data);
        break;

      case 'openExternalLink':
        this.handleOpenExternalLink(message.data);
        break;

      case 'openSettings':
        this.handleOpenSettings(message.data);
        break;

      case 'depPulse.resetLlmConfig':
        void vscode.commands.executeCommand('depPulse.resetLlmConfig');
        break;

      case 'depPulse.toggleCache':
        vscode.commands.executeCommand('depPulse.toggleCache');
        break;

      case 'cleanupUnusedPackages.preview':
        void vscode.commands.executeCommand('depPulse.cleanupUnusedPackages.preview');
        break;

      case 'cleanupUnusedPackages.execute':
        void vscode.commands.executeCommand('depPulse.cleanupUnusedPackages.execute');
        break;

      default:
        this.log(`Unknown command: ${message.command}`);
    }
  }

  /**
   * Updates the internal cache enabled state
   * Called by ConfigurationListener when settings change
   */
  public setCacheEnabled(enabled: boolean): void {
    const previousState = this._isCacheEnabled;
    this._isCacheEnabled = enabled;
    this.log(`Cache enabled state updated from ${previousState} to ${enabled}`);

    if (!enabled) {
      this.log('Cache disabled - clearing alternative caches');
      this.alternativeCache.clear();
      this.alternativeProviders.clear();
      this.alternativeErrors.clear();
      this.alternativeErrorProviders.clear();
    }

    // Send message to webview if it exists
    const panel = this.webviewManager?.getPanel();
    if (panel) {
      this.log(`Sending cacheStatusChanged to webview: ${enabled}`);
      this.sendMessage({
        type: 'cacheStatusChanged',
        data: { enabled },
      });
    } else {
      this.log('Webview not available, cache state stored for later');
    }
  }

  /**
   * Handle webview ready signal
   * Sends pending analysis data once webview is ready to receive it
   */
  private async handleWebviewReady(): Promise<void> {
    this.log('Webview is ready');

    // Ensure webview manager exists (should exist if we received ready signal)
    if (!this.webviewManager) {
      this.log('WARNING: Webview ready signal received but manager not initialized');
      return;
    }

    // Send current cache status immediately to ensure UI is in sync
    // We explicitly check the configuration here to ensure we have the latest value
    // This fixes a race condition where the controller might have been initialized with an old value
    const currentCacheEnabled = isCacheEnabled();
    this._isCacheEnabled = currentCacheEnabled;

    this.sendMessage({
      type: 'cacheStatusChanged',
      data: { enabled: currentCacheEnabled },
    });

    // Mark webview as ready (this is called when ready message is received)
    // The webviewManager's internal handleWebviewReady is called from its message handler,
    // but when DashboardController.handleMessage is called directly (e.g., in tests),
    // we need to ensure the manager knows it's ready
    this.webviewManager.markAsReady();

    // Check if we have pending data prepared
    if (this.pendingData) {
      this.log('Sending pending data to ready webview');
      try {
        this.webviewManager.sendData(this.pendingData);
        this.log('Pending data sent to webview successfully');
        this.pendingData = null;
      } catch (error) {
        this.log(`ERROR: Failed to send pending data: ${error}`);
        if (error instanceof Error && error.stack) {
          this.log(`Stack trace: ${error.stack}`);
        }
      }
      return;
    }

    // If a scan is in progress, don't send cached data - it will hide the loading modal
    // Let the scan completion handle sending the fresh data
    if (isScanningInProgress()) {
      this.log(
        'A scan is currently in progress - skipping cached data to avoid hiding the loading modal'
      );
      // Still need to ensure the cache toggle reflects the correct state
      this.sendMessage({
        type: 'cacheStatusChanged',
        data: { enabled: this._isCacheEnabled },
      });

      // IMPORTANT: Show the progress modal immediately if webview becomes ready during scan
      // This fixes the issue where dashboard opens during scan but modal doesn't appear
      const currentStatus = getCurrentAnalysisStatus();
      if (currentStatus) {
        this.log(
          `Scan in progress detected - showing modal with progress: ${currentStatus.progress}%, message: ${currentStatus.message}`
        );
        this.sendProgressUpdate(currentStatus.progress, currentStatus.message);
      } else {
        // Fallback: show modal with default message if status unavailable
        this.log('Scan in progress but status unavailable - showing default modal');
        this.sendProgressUpdate(0, 'Analyzing dependencies...');
      }
      return;
    }

    // If no pending data but we have current analysis, transform and send it
    if (this.currentAnalysis) {
      this.log(
        `Sending current analysis data to ready webview (${this.currentAnalysis.dependencies.length} dependencies)`
      );
      try {
        // Detect package manager
        const packageManager = await this.detectPackageManager();
        this.log(`Detected package manager: ${packageManager}`);

        // Transform analysis data to dashboard format
        const dashboardData = this.dataTransformer.transformAnalysisData(this.currentAnalysis, {
          transitiveEnabled: this._transitiveEnabled,
        });
        dashboardData.packageManager = packageManager;
        dashboardData.transitiveEnabled = this._transitiveEnabled;

        // Apply stored cache status
        if (this.currentCacheStatus) {
          dashboardData.isCached = this.currentCacheStatus.isCached;
          dashboardData.cacheAge = this.currentCacheStatus.cacheAge;
        }

        // Apply stored performance metrics
        if (this.currentPerformanceMetrics) {
          dashboardData.performanceMetrics = this.currentPerformanceMetrics;
        }

        this.log(
          `Transformed data: ${dashboardData.dependencies.length} dependencies, health score: ${dashboardData.healthScore.overall}`
        );

        // Send to webview
        this.webviewManager.sendData(dashboardData);
        this.log('Analysis data sent to webview successfully');
      } catch (error) {
        this.log(`ERROR: Failed to send data to ready webview: ${error}`);
        if (error instanceof Error && error.stack) {
          this.log(`Stack trace: ${error.stack}`);
        }
      }
    } else {
      this.log('WARNING: No analysis data available to send to webview');
      this.log('This is normal if the dashboard was opened before the first scan completed');

      // Even if no analysis data, we MUST send the cache status
      // because the webview defaults to "Cache On" and needs to be corrected
      this.log(`Sending initial cache status to webview: ${this._isCacheEnabled}`);
      this.sendMessage({
        type: 'cacheStatusChanged',
        data: { enabled: this._isCacheEnabled },
      });
    }
  }

  /**
   * Handle refresh command from webview
   * Triggers scan to refresh analysis
   */
  private async handleRefresh(force: boolean = false): Promise<void> {
    this.log(`Refresh requested from dashboard (force: ${force})`);

    // Check if scan is already in progress BEFORE showing modal
    // If scan is already running, show current progress instead of "Starting Analysis..."
    if (isScanningInProgress()) {
      this.log('Scan already in progress - showing current progress instead of starting new scan');
      const currentStatus = getCurrentAnalysisStatus();
      if (currentStatus) {
        this.sendProgressUpdate(currentStatus.progress, currentStatus.message);
      } else {
        this.sendProgressUpdate(0, 'Analysis in progress...');
      }
      // Don't start a new scan if one is already running
      return;
    }

    // No scan in progress - start a new scan
    try {
      // Send initial progress to show modal immediately
      this.sendProgressUpdate(0, 'Starting Analysis...');

      // Trigger scan command to refresh analysis
      this.log('Executing depPulse.scan command...');
      await vscode.commands.executeCommand('depPulse.scan', { bypassCache: force });
      this.log('Scan command completed successfully');

      // Note: The scan command will call update() which sends the analysisUpdate message
      // No need to send additional success message here
    } catch (error) {
      this.log(`Error executing scan command: ${error}`);
      if (error instanceof Error && error.stack) {
        this.log(`Stack trace: ${error.stack}`);
      }

      // Send error to webview
      if (!this.webviewManager) {
        return;
      }
      const errorPanel = this.webviewManager.getPanel();
      if (errorPanel) {
        errorPanel.webview.postMessage({
          type: 'error',
          data: {
            message: `Failed to refresh: ${error instanceof Error ? error.message : String(error)}`,
          },
        });
      }
    }
  }

  /**
   * Send progress update to webview
   * @param progress Progress percentage (0-100)
   * @param message Optional progress message
   */
  public sendProgressUpdate(progress: number, message?: string): void {
    // Only send progress if webview manager exists (dashboard is open)
    if (this.webviewManager) {
      this.webviewManager.sendProgressUpdate(progress, message);
    }
  }

  /**
   * Handle filter change from webview
   * @param data Filter options
   */
  private handleFilterChange(data: unknown): void {
    this.log(`Filter change: ${JSON.stringify(data)}`);
    // Filter logic will be handled in webview
    // This is just for logging/telemetry
  }

  /**
   * Handle search from webview
   * @param data Search term
   */
  private handleSearch(data: unknown): void {
    this.log(`Search: ${JSON.stringify(data)}`);
    // Search logic will be handled in webview
    // This is just for logging/telemetry
  }

  /**
   * Handle view details command
   * @param data Dependency name
   */
  private handleViewDetails(data: unknown): void {
    this.log(`View details: ${JSON.stringify(data)}`);
    // Details will be shown in webview
    // This is just for logging/telemetry
  }

  /**
   * Handle update dependency command
   * @param data Dependency name and version
   */
  private async handleUpdateDependency(data: unknown): Promise<void> {
    this.log(`Update dependency: ${JSON.stringify(data)}`);

    const updateData = data as {
      name: string;
      version: string;
      workspaceFolder?: string;
      packageRoot?: string;
    };
    if (!updateData.name || !updateData.version) {
      this.log('Invalid update data');
      return;
    }

    const packageManager = await this.detectPackageManager(
      updateData.packageRoot || updateData.workspaceFolder
    );
    this.log(`Detected package manager: ${packageManager}`);
    const cwd = updateData.packageRoot || updateData.workspaceFolder;
    const command = this.generateUpdateCommand(
      packageManager,
      updateData.name,
      updateData.version,
      cwd
    );
    this.log(`Generated command: ${command}`);

    await this.executeInTerminal(command);
  }

  /**
   * Handle export report command
   */
  private async handleExportReport(data: unknown): Promise<void> {
    this.log('Export report requested');

    const exportData = data as {
      format: string;
      filename: string;
      content: string;
      workspaceFolder?: string;
      packageRoot?: string;
    };
    if (!exportData.filename || !exportData.content) {
      this.log('Invalid export data');
      return;
    }

    try {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      const workspaceFolder = this.resolveWorkspaceFolder(
        exportData.packageRoot || exportData.workspaceFolder,
        workspaceFolders
      );
      const defaultRoot = workspaceFolder?.uri ?? workspaceFolders[0].uri;
      const defaultPath = vscode.Uri.joinPath(defaultRoot, exportData.filename);
      const filePath =
        (await vscode.window.showSaveDialog({
          defaultUri: defaultPath,
          saveLabel: 'Export DepPulse Report',
          filters: exportData.format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] },
        })) ?? defaultPath;

      // Write file
      await vscode.workspace.fs.writeFile(filePath, Buffer.from(exportData.content, 'utf8'));

      this.log(`Exported report to: ${filePath.fsPath}`);

      // Show success notification with action to open file
      const action = await vscode.window.showInformationMessage(
        `Report exported to ${exportData.filename}`,
        'Open File'
      );

      if (action === 'Open File') {
        const document = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(document);
      }
    } catch (error) {
      this.log(`Export failed: ${error}`);
      vscode.window.showErrorMessage(`Failed to export report: ${error}`);
    }
  }

  /**
   * Handle show alternatives command
   * @param data Dependency name
   */
  private async handleShowAlternatives(data: unknown): Promise<void> {
    const payload = data as { name?: string };
    const packageName = payload?.name;

    if (!packageName) {
      this.log('showAlternatives invoked without package name');
      return;
    }

    if (!this.webviewManager) {
      return;
    }
    const panel = this.webviewManager.getPanel();
    if (!panel) {
      return;
    }

    if (!this._alternativeService) {
      this.log('Alternative suggestion service not available');
      panel.webview.postMessage({
        type: 'alternativesError',
        data: {
          packageName,
          message: 'Alternative suggestions are unavailable in this build.',
        },
      });
      return;
    }

    if (!this._alternativeService.isConfigured()) {
      const validation = evaluateLlmConfig();
      if (validation.status === 'missing') {
        panel.webview.postMessage({
          type: 'alternativesError',
          data: {
            packageName,
            message: validation.message,
            provider: validation.provider,
            missingKey: validation.missingKey,
            missingModel: validation.missingModel,
          },
        });
        return;
      }

      panel.webview.postMessage({
        type: 'alternativesConfigRequired',
        data: { packageName },
      });
      return;
    }

    const provider = this._alternativeService.getProvider();

    if (this._isCacheEnabled && this.alternativeCache.has(packageName)) {
      const suggestions = this.alternativeCache.get(packageName) || [];
      const provider =
        this.alternativeProviders.get(packageName) || this._alternativeService.getProvider();
      panel.webview.postMessage({
        type: 'alternativesResult',
        data: { packageName, suggestions, provider },
      });
      return;
    }

    if (this._isCacheEnabled && this.alternativeErrors.has(packageName)) {
      panel.webview.postMessage({
        type: 'alternativesError',
        data: {
          packageName,
          message: this.alternativeErrors.get(packageName),
          provider: this.alternativeErrorProviders.get(packageName),
        },
      });
      return;
    }

    if (this.alternativeInFlight.has(packageName)) {
      return;
    }

    this.alternativeInFlight.add(packageName);
    panel.webview.postMessage({
      type: 'alternativesLoading',
      data: { packageName, provider },
    });

    try {
      const packageManager = await this.detectPackageManager();
      const description = this.currentAnalysis?.dependencies.find(
        (dep) => dep.dependency.name === packageName
      )?.packageInfo?.description;

      const suggestions = await this._alternativeService.getSuggestions(
        packageName,
        packageManager,
        description
      );

      this.alternativeCache.set(packageName, suggestions);
      this.alternativeProviders.set(packageName, provider);
      this.alternativeErrorProviders.delete(packageName);

      panel.webview.postMessage({
        type: 'alternativesResult',
        data: { packageName, suggestions, provider },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.alternativeErrors.set(packageName, message);
      this.alternativeErrorProviders.set(packageName, provider);

      panel.webview.postMessage({
        type: 'alternativesError',
        data: { packageName, message, provider },
      });
    } finally {
      this.alternativeInFlight.delete(packageName);
    }
  }

  /**
   * Handle view logs command
   * Opens the DepPulse output channel
   */
  private handleViewLogs(): void {
    this.log('View logs requested from dashboard');
    this._outputChannel.show();
  }

  /**
   * Handle clipboard copy requests originating from the webview
   * @param data Object containing the text to copy
   */
  private handleCopyToClipboard(data: unknown): void {
    const payload = data as { text?: string };
    if (!payload?.text) {
      this.log('copyToClipboard invoked without text payload');
      return;
    }

    vscode.env.clipboard.writeText(payload.text).then(
      () => {
        this.log(`Copied ${payload.text?.length ?? 0} characters to clipboard`);
      },
      (error) => {
        this.log(`Failed to copy text to clipboard: ${error}`);
      }
    );
  }

  /**
   * Handle external link open requests from the webview
   * @param data Object containing the target URL
   */
  private handleOpenExternalLink(data: unknown): void {
    const payload = data as { url?: string };
    if (!payload?.url) {
      this.log('openExternalLink invoked without url payload');
      return;
    }

    vscode.env.openExternal(vscode.Uri.parse(payload.url)).then(
      () => {
        this.log(`Opened external link: ${payload.url}`);
      },
      (error) => {
        this.log(`Failed to open external link (${payload.url}): ${error}`);
      }
    );
  }

  /**
   * Handle open settings command from the webview
   */
  private handleOpenSettings(data: unknown): void {
    const payload = data as {
      query?: string;
      provider?: 'github' | 'openrouter' | 'openai' | 'gemini';
      scope?: 'key' | 'model' | 'both';
    };
    const query = payload?.query || 'depPulse.api';
    const provider = payload?.provider;
    const scope = payload?.scope || 'both';

    // If only key is requested, just open secrets flow
    if (scope === 'key' && provider) {
      void vscode.commands.executeCommand('depPulse.configureSecrets', provider);
      this.log(`Opening secrets for provider: ${provider}`);
      return;
    }

    // If only model is requested, open settings without secrets flow
    if (scope === 'model') {
      if (query) {
        vscode.commands.executeCommand('workbench.action.openSettings', query);
        this.log(`Opening settings for query: ${query} (model only)`);
      }
      return;
    }

    if (provider) {
      // First, open secrets flow for the provider
      void vscode.commands.executeCommand('depPulse.configureSecrets', provider);
      // Then, open settings for the related model (if provided)
      if (query) {
        void vscode.commands.executeCommand('workbench.action.openSettings', query);
        this.log(`Opening settings for query: ${query} after secrets for ${provider}`);
      }
      return;
    }

    vscode.commands.executeCommand('workbench.action.openSettings', query);
    this.log(`Opening settings for query: ${query}`);
  }

  /**
   * Handle log error command
   * Logs error details from webview to output channel
   * @param data Error data from webview
   */
  private handleLogError(data: unknown): void {
    // Handle string messages (e.g. from dashboard-core.js info messages)
    if (typeof data === 'string') {
      this.log(`[Dashboard Info] ${data}`);
      return;
    }

    const errorData = data as {
      message: string;
      stack?: string;
      timestamp: string;
      userAgent?: string;
      dashboardState?: unknown;
    };

    this.log('=== ERROR FROM DASHBOARD ===');
    this.log(`Timestamp: ${errorData.timestamp}`);
    this.log(`Message: ${errorData.message}`);

    if (errorData.stack) {
      this.log(`Stack: ${errorData.stack}`);
    }

    if (errorData.userAgent) {
      this.log(`User Agent: ${errorData.userAgent}`);
    }

    if (errorData.dashboardState) {
      this.log(`Dashboard State: ${JSON.stringify(errorData.dashboardState, null, 2)}`);
    }

    this.log('=== END ERROR ===');
  }

  /**
   * Detect package manager from lock files
   * @returns Detected package manager
   */
  private async detectPackageManager(targetPath?: string): Promise<'npm' | 'pnpm' | 'yarn'> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.log('No workspace folder found, defaulting to npm');
      return 'npm';
    }

    const workspaceFolder = this.resolveWorkspaceFolder(targetPath, workspaceFolders);
    const rootPath = workspaceFolder?.uri.fsPath ?? workspaceFolders[0].uri.fsPath;
    const scanRoots = this.buildPackageManagerSearchRoots(targetPath, rootPath);

    this.log(
      `Detecting package manager for target: ${targetPath || rootPath} using roots: ${scanRoots.join(', ')}`
    );

    for (const scanRoot of scanRoots) {
      const packageManager = await this.detectPackageManagerInRoot(scanRoot);
      if (packageManager) {
        return packageManager;
      }
    }

    this.log('No lock file found, defaulting to npm');
    return 'npm';
  }

  private async detectPackageManagerInRoot(
    rootPath: string
  ): Promise<'npm' | 'pnpm' | 'yarn' | undefined> {
    const rootUri = {
      fsPath: rootPath,
      path: rootPath,
    } as vscode.Uri;

    // Check for pnpm-lock.yaml
    try {
      const pnpmLockPath = vscode.Uri.joinPath(rootUri, 'pnpm-lock.yaml');
      await vscode.workspace.fs.stat(pnpmLockPath);
      this.log(`Found pnpm-lock.yaml at ${pnpmLockPath.fsPath}`);
      return 'pnpm';
    } catch {
      this.log('pnpm-lock.yaml not found');
    }

    // Check for yarn.lock
    try {
      const yarnLockPath = vscode.Uri.joinPath(rootUri, 'yarn.lock');
      await vscode.workspace.fs.stat(yarnLockPath);
      this.log(`Found yarn.lock at ${yarnLockPath.fsPath}`);
      return 'yarn';
    } catch {
      this.log('yarn.lock not found');
    }

    // Check for package-lock.json
    try {
      const npmLockPath = vscode.Uri.joinPath(rootUri, 'package-lock.json');
      await vscode.workspace.fs.stat(npmLockPath);
      this.log(`Found package-lock.json at ${npmLockPath.fsPath}`);
      return 'npm';
    } catch {
      this.log('package-lock.json not found');
    }
    return undefined;
  }

  /**
   * Handle bulk update command
   * @param data Array of packages to update
   */
  private async handleBulkUpdate(data: unknown): Promise<void> {
    this.log(`Bulk update: ${JSON.stringify(data)}`);

    const bulkData = data as {
      packages: Array<{
        name: string;
        version: string;
        workspaceFolder?: string;
        packageRoot?: string;
      }>;
    };
    if (!bulkData.packages || bulkData.packages.length === 0) {
      this.log('No packages to update');
      return;
    }

    const commands = await Promise.all(
      bulkData.packages.map(async (pkg) =>
        this.generateUpdateCommand(
          await this.detectPackageManager(pkg.packageRoot || pkg.workspaceFolder),
          pkg.name,
          pkg.version,
          pkg.packageRoot || pkg.workspaceFolder
        )
      )
    );

    // Execute all commands in sequence
    const combinedCommand = commands.join(' && ');
    await this.executeInTerminal(combinedCommand);
  }

  /**
   * Generate update command based on package manager
   * @param packageManager Package manager (npm, pnpm, yarn)
   * @param packageName Package name
   * @param version Target version
   * @returns Update command string
   */
  private generateUpdateCommand(
    packageManager: 'npm' | 'pnpm' | 'yarn',
    packageName: string,
    version: string,
    cwd?: string
  ): string {
    switch (packageManager) {
      case 'pnpm':
        return cwd
          ? `pnpm -C "${cwd}" update ${packageName}@${version}`
          : `pnpm update ${packageName}@${version}`;
      case 'yarn':
        return cwd
          ? `yarn --cwd "${cwd}" upgrade ${packageName}@${version}`
          : `yarn upgrade ${packageName}@${version}`;
      default:
        return cwd
          ? `npm --prefix "${cwd}" update ${packageName}@${version}`
          : `npm update ${packageName}@${version}`;
    }
  }

  /**
   * Execute command in integrated terminal
   * @param command Command to execute
   */
  private async executeInTerminal(command: string): Promise<void> {
    // Get or create terminal
    let terminal = vscode.window.terminals.find(
      (t: vscode.Terminal) => t.name === 'DepPulse Updates'
    );

    if (!terminal) {
      terminal = vscode.window.createTerminal('DepPulse Updates');
      this.log('Created new terminal: DepPulse Updates');
    }

    // Show terminal and send command
    terminal.show(true); // true = preserve focus on editor

    // Send command with visible prompt
    terminal.sendText(command, false); // false = show command but let user review before executing

    this.log(`Sent command to terminal: ${command}`);

    // Show user notification
    vscode.window
      .showInformationMessage(
        `Update command ready in terminal. Press Enter to execute: ${command}`,
        'Execute Now',
        'Cancel'
      )
      .then((action: string | undefined) => {
        if (action === 'Execute Now' && terminal) {
          terminal.sendText(''); // Send Enter to execute
        }
      });
  }

  /**
   * Dispose of the dashboard controller and clean up resources
   */
  public dispose(): void {
    this.log('Disposing DashboardController');
    if (this.webviewManager) {
      this.webviewManager.dispose();
      this.webviewManager = undefined;
    }
    // Clear caches
    this.alternativeCache.clear();
    this.alternativeErrors.clear();
    this.alternativeInFlight.clear();
    this.alternativeProviders.clear();
    this.alternativeErrorProviders.clear();
    this.pendingData = null;
    this.currentAnalysis = undefined;
    this.log('DashboardController disposed');
  }

  /**
   * Log message to output channel with timestamp
   * @param message Message to log
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    this._outputChannel.appendLine(`[${timestamp}] [DashboardController] ${message}`);
  }

  private resolveWorkspaceFolder(
    targetPath: string | undefined,
    workspaceFolders: readonly vscode.WorkspaceFolder[]
  ): vscode.WorkspaceFolder | undefined {
    if (!targetPath) {
      return workspaceFolders[0];
    }

    const normalizedTarget = path.resolve(targetPath);
    return [...workspaceFolders]
      .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
      .find((folder) => {
        const folderPath = path.resolve(folder.uri.fsPath);
        return (
          normalizedTarget === folderPath || normalizedTarget.startsWith(`${folderPath}${path.sep}`)
        );
      });
  }

  private buildPackageManagerSearchRoots(
    targetPath: string | undefined,
    workspaceRoot: string
  ): string[] {
    const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
    const roots: string[] = [];

    if (targetPath) {
      let current = path.resolve(targetPath);
      while (
        current === normalizedWorkspaceRoot ||
        current.startsWith(`${normalizedWorkspaceRoot}${path.sep}`)
      ) {
        roots.push(current);
        if (current === normalizedWorkspaceRoot) {
          break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
          break;
        }
        current = parent;
      }
    }

    if (!roots.includes(normalizedWorkspaceRoot)) {
      roots.push(normalizedWorkspaceRoot);
    }

    return roots;
  }
}
