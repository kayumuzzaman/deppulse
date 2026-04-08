import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { WebviewMessage } from '../types';
import type { DashboardData } from './DashboardDataTransformer';

/**
 * Manages the webview panel lifecycle and content generation
 */
export class DashboardWebviewManager {
  private panel: vscode.WebviewPanel | undefined;
  private extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private isWebviewReady: boolean = false;
  private readyTimeout: NodeJS.Timeout | null = null;
  private isHandlingReady: boolean = false;
  private log: (message: string) => void;
  private onMessageHandler?: (message: WebviewMessage) => void;
  private onReadyCallback?: () => Promise<void>;
  private extensionMode: vscode.ExtensionMode;

  constructor(
    extensionUri: vscode.Uri,
    log: (message: string) => void,
    extensionMode: vscode.ExtensionMode
  ) {
    this.extensionUri = extensionUri;
    this.log = log;
    this.extensionMode = extensionMode;
  }

  /**
   * Set the message handler for webview messages
   */
  public setMessageHandler(handler: (message: WebviewMessage) => void): void {
    this.onMessageHandler = handler;
  }

  /**
   * Set the callback to execute when webview is ready
   */
  public setReadyCallback(callback: () => Promise<void>): void {
    this.onReadyCallback = callback;
  }

  /**
   * Show the dashboard webview panel
   * Creates a new panel if one doesn't exist, or reveals existing panel
   */
  public show(): void {
    if (this.panel) {
      // Panel already exists, just reveal it
      this.panel.reveal(vscode.ViewColumn.One);
      this.log('Dashboard panel revealed');
      return;
    }

    // Clear any existing timeout from previous panel
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }

    // Reset webview readiness state for new panel
    this.isWebviewReady = false;
    this.isHandlingReady = false;

    // Create new webview panel
    this.panel = vscode.window.createWebviewPanel(
      'depPulseDashboard',
      'DepPulse Dashboard',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'resources'),
          vscode.Uri.joinPath(this.extensionUri, 'out'),
        ],
      }
    );

    // Set webview HTML content
    this.panel.webview.html = this.getWebviewContent(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        if (message.command === 'ready') {
          this.handleWebviewReady();
        } else if (this.onMessageHandler) {
          this.onMessageHandler(message);
        }
      },
      null,
      this.disposables
    );

    // Handle panel disposal
    this.panel.onDidDispose(
      () => {
        this.panel = undefined;
        this.isWebviewReady = false;
        this.isHandlingReady = false;
        // Clear timeout if panel is disposed before ready signal
        if (this.readyTimeout) {
          clearTimeout(this.readyTimeout);
          this.readyTimeout = null;
        }
        this.log('Dashboard panel disposed');
      },
      null,
      this.disposables
    );

    this.log('Dashboard panel created, waiting for webview ready signal');

    // Set timeout fallback (5 seconds) in case webview never signals ready
    this.readyTimeout = setTimeout(() => {
      if (!this.isWebviewReady && this.panel) {
        this.log('WARNING: Webview ready signal timeout - attempting to send data anyway');
        // Attempt to send data as fallback
        this.handleWebviewReady().catch((error) => {
          this.log(`Error in timeout fallback: ${error}`);
        });
      }
    }, 5000);
  }

  /**
   * Hide the dashboard webview panel
   */
  public hide(): void {
    if (this.panel) {
      this.panel.dispose();
      this.panel = undefined;
      this.log('Dashboard panel hidden');
    }
  }

  /**
   * Get the current webview panel (if exists)
   */
  public getPanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }

  /**
   * Check if webview is ready to receive messages
   */
  public isReady(): boolean {
    return this.isWebviewReady;
  }

  /**
   * Mark webview as ready (for use when ready signal is received outside of message handler)
   * This is useful in tests or when the ready signal is handled directly
   */
  public markAsReady(): void {
    this.isWebviewReady = true;
    // Clear the timeout since we're marking as ready
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }
  }

  /**
   * Send data to webview
   */
  public sendData(data: DashboardData): void {
    if (!this.panel) {
      this.log('WARNING: Cannot send data - panel does not exist');
      return;
    }

    if (!this.isWebviewReady) {
      this.log('WARNING: Cannot send data - webview not ready yet');
      return;
    }

    try {
      this.log(
        `Sending analysisUpdate message with ${data.dependencies?.length || 0} dependencies`
      );

      // #region agent log
      this.panel.webview.postMessage({ type: 'analysisUpdate', data });
      this.log('analysisUpdate message sent successfully');
    } catch (error) {
      this.log(`ERROR sending data to webview: ${error}`);
      if (error instanceof Error && error.stack) {
        this.log(`Stack trace: ${error.stack}`);
      }
    }
  }

  /**
   * Send progress update to webview
   */
  public sendProgressUpdate(progress: number, message?: string): void {
    if (!this.panel || !this.isWebviewReady) {
      return;
    }

    try {
      this.panel.webview.postMessage({
        type: 'progressUpdate',
        data: {
          progress: Math.max(0, Math.min(100, progress)),
          message,
        },
      });
    } catch (error) {
      this.log(`Error sending progress update: ${error}`);
    }
  }

  /**
   * Handle webview ready signal
   */
  private async handleWebviewReady(): Promise<void> {
    // Prevent concurrent execution
    if (this.isHandlingReady) {
      this.log('WARNING: handleWebviewReady already in progress, skipping');
      return;
    }

    this.isHandlingReady = true;

    try {
      this.log('Webview ready signal received');

      // Check if panel still exists before proceeding
      if (!this.panel) {
        this.log('WARNING: Panel disposed before ready handling completed');
        return;
      }

      // Set ready flag first so sendData() works when called from callback
      this.isWebviewReady = true;

      // Clear the timeout since we received the ready signal
      if (this.readyTimeout) {
        clearTimeout(this.readyTimeout);
        this.readyTimeout = null;
      }

      // Execute ready callback if set and panel still exists
      if (this.onReadyCallback && this.panel) {
        try {
          await this.onReadyCallback();
        } catch (error) {
          this.log(`Error in ready callback: ${error}`);
        }
      }

      this.log('Webview ready handling completed');
    } finally {
      this.isHandlingReady = false;
    }
  }

  /**
   * Generate the HTML content for the webview
   * @param webview The webview instance
   * @returns HTML string
   */
  private getWebviewContent(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    // Get URIs for dashboard modules (load in dependency order)
    const stateScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'dashboard-state.js')
    );
    const utilsScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'dashboard-utils.js')
    );
    const chartsScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'dashboard-charts.js')
    );
    const filtersScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'dashboard-filters.js')
    );
    const tableScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'dashboard-table.js')
    );
    const cleanupScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'cleanup-widget.js')
    );
    const coreScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'dashboard-core.js')
    );
    const cssPath = vscode.Uri.joinPath(
      this.extensionUri,
      'resources',
      'webview',
      'output.css'
    ).fsPath;
    let cssContent = '';
    try {
      cssContent = fs.readFileSync(cssPath, 'utf-8');
      this.log(`CSS file read successfully. Length: ${cssContent.length}`);
      // Escape backticks to prevent breaking the template string
      cssContent = cssContent.replace(/`/g, '\\`');
    } catch (e) {
      this.log(`Error reading CSS file from ${cssPath}: ${e}`);
    }
    const chartJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'chart.js')
    );

    // Generate the complete HTML content for the dashboard
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline' https:; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <title>DepPulse Dashboard</title>
  <script nonce="${nonce}">
    window.isDevelopment = ${this.extensionMode === vscode.ExtensionMode.Development};
  </script>
  
  <!-- Local Tailwind CSS -->
  <!-- Local Tailwind CSS (Inlined) -->
  <style>
    ${cssContent}
  </style>
  <!-- Dropdown arrow focus override & webview compatibility overrides -->
  <style>
    /*
     * Un-layered overrides: Tailwind v4 wraps all utilities in @layer,
     * but some VS Code forks may inject un-layered default
     * styles (e.g. body { background-color: var(--vscode-editor-background) })
     * that always win over layered rules per the CSS cascade spec.
     * These explicit rules sit outside any @layer so they take precedence.
     */
    body {
      background-color: #f9fafb;
      color: #111827;
    }
    html.dark body {
      background-color: #111827;
      color: #f3f4f6;
    }

    /* Keep dropdown chevrons/text aligned like the export button */
    .dropdown-select {
      padding-top: 0.625rem;
      padding-bottom: 0.625rem;
      padding-left: 0.75rem;
      padding-right: 2.5rem;
      line-height: 1.25rem;
    }
    .select-chevron {
      position: absolute;
      right: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      width: 1rem;
      height: 1rem;
      pointer-events: none;
    }
  </style>
  
  <!-- Local Chart.js -->
  <script nonce="${nonce}" src="${chartJsUri}"></script>
  <script nonce="${nonce}" src="${cleanupScriptUri}"></script>
  

</head>
<body class="bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 min-h-screen">
  <div class="max-w-7xl mx-auto p-6">
    <!-- Header -->
    <header id="main-header" class="sticky-header mb-8 -mx-6 px-6 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-lg">
      <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4 pt-6">
        <div class="flex items-center gap-3">
          <!-- Animated Gradient Title -->
          <h1 class="gradient-title">DepPulse</h1>
          
          <!-- Info Icon with Smart Tooltip -->
          <div class="info-tooltip-wrapper">
            <button class="info-icon-btn" aria-label="Information about scanning accuracy" aria-describedby="info-tooltip-content">
              <svg class="info-icon-svg" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
              </svg>
              <span class="info-icon-ring"></span>
            </button>
            
            <!-- Smart Floating Tooltip -->
            <div id="info-tooltip-content" class="info-tooltip-panel" role="tooltip">
              <div class="info-tooltip-arrow"></div>
              <div class="info-tooltip-content">
                <div class="info-tooltip-header">
                  <div class="info-tooltip-icon-wrapper">
                    <svg class="info-tooltip-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
                    </svg>
                  </div>
                  <h4 class="info-tooltip-title">Scanning Accuracy</h4>
                </div>
                <p class="info-tooltip-text">
                  Vulnerability data is aggregated from multiple sources including GitHub Advisory and OSV. Minor discrepancies may occur due to differing update cycles.
                </p>
                <div class="info-tooltip-footer">
                  <span class="info-tooltip-badge">
                    <svg class="info-tooltip-badge-icon" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                    Verify critical findings
                  </span>
                </div>
              </div>
            </div>
          </div>

        </div>
        
        <div class="flex flex-wrap gap-2">
          <button id="refresh-btn" 
                  class="modern-btn modern-btn-primary"
                  aria-label="Refresh dependency analysis">
            <svg id="refresh-icon" class="modern-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            <span>Refresh</span>
          </button>

          <div class="relative">
            <button id="export-btn" 
                    class="modern-btn modern-btn-secondary"
                    aria-label="Export report">
              <svg class="modern-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
              </svg>
              <span>Export</span>
              <svg class="modern-btn-icon" style="width: 0.75rem; height: 0.75rem;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
              </svg>
            </button>
            <div id="export-menu" class="hidden absolute right-0 mt-2 w-32 glass-modal rounded-lg shadow-xl border-0 z-10 animate-scale-up">
              <button id="export-json" class="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-md">
                JSON
              </button>
              <button id="export-csv" class="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-b-md">
                CSV
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="flex flex-wrap items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
        <button id="toggle-cache-btn" class="group flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-sm" title="Toggle cache usage for faster or fresh scans">
          <div class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-blue-600" id="cache-toggle-visual">
            <span aria-hidden="true" class="translate-x-3 pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out" id="cache-toggle-knob"></span>
          </div>
          <span id="cache-toggle-text">Cache On</span>
        </button>

        <button id="toggle-performance-metrics" class="group flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-xs font-medium text-gray-700 dark:text-gray-300 hover:border-blue-500 dark:hover:border-blue-500 transition-all shadow-sm" title="Toggle performance metrics">
          <div class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out bg-gray-200 dark:bg-gray-700 group-hover:bg-gray-300 dark:group-hover:bg-gray-600" id="metrics-toggle-switch">
            <span aria-hidden="true" class="translate-x-0 pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out" id="metrics-toggle-knob"></span>
          </div>
          <span id="metrics-toggle-text">Show Metrics</span>
        </button>

        <div class="flex-1"></div>
        
        <span id="package-manager-badge" class="package-manager-badge mr-3">
          npm
        </span>

        <span id="last-scanned" title="">Last scanned: --</span>
        <span id="cache-indicator" class="hidden cache-tag">
          <!-- Content populated by JS -->
        </span>
      </div>
    </header>

    <!-- Performance Metrics Panel (collapsible) - Moved outside header to prevent sticky behavior -->
    <div id="performance-metrics-panel" class="hidden mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm animate-fade-in">
      <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
        <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
        </svg>
        Performance Metrics
      </h3>
      <div class="grid grid-cols-3 gap-4 text-sm">
        <div class="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
          <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Scan Duration</div>
          <div id="performance-scan-duration" class="font-mono font-semibold text-gray-900 dark:text-gray-100">--</div>
        </div>
        <div class="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
          <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Memory Usage</div>
          <div id="performance-memory" class="font-mono font-semibold text-gray-900 dark:text-gray-100">--</div>
        </div>
        <div class="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-md">
          <div class="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1">Dependencies</div>
          <div id="performance-dependency-count" class="font-mono font-semibold text-gray-900 dark:text-gray-100">--</div>
        </div>
      </div>
    </div>

    <!-- Dashboard Content -->
    <div id="dashboard-content">
      <!-- Offline/Limited Connectivity Banner -->
      <div id="offline-notification" class="hidden mb-6 bg-amber-100/70 dark:bg-gray-900/70 border border-amber-200/80 dark:border-amber-500/40 rounded-xl p-4 shadow-md">
        <div class="flex items-start gap-3">
          <span class="text-2xl text-amber-500 dark:text-amber-300">⚠️</span>
          <div class="flex-1">
            <h3 class="font-semibold text-gray-900 dark:text-gray-100 mb-1">
              Limited Connectivity
            </h3>
            <p id="offline-message" class="text-sm text-gray-800 dark:text-gray-100">
              Unable to reach external services. Showing cached data where available.
            </p>
          </div>
          <button id="close-offline-notification" class="text-gray-600 dark:text-gray-200 hover:text-red-500 dark:hover:text-white" aria-label="Close notification">
            ✕
          </button>
        </div>
      </div>

      <!-- Fallback Notification Banner -->
      <div id="fallback-notification" class="hidden mb-6 bg-yellow-50 dark:bg-yellow-900 border border-yellow-200 dark:border-yellow-700 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <span class="text-2xl">⚠️</span>
          <div class="flex-1">
            <h3 class="font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
              Fallback to GitHub Advisory
            </h3>
            <p id="fallback-message" class="text-sm text-yellow-700 dark:text-yellow-300">
              OSV.dev was unavailable. Using GitHub Advisory Database as fallback.
            </p>
          </div>
          <button id="close-fallback-notification" class="text-yellow-600 dark:text-yellow-400 hover:text-yellow-800 dark:hover:text-yellow-200" aria-label="Close notification">
            ✕
          </button>
        </div>
      </div>

      <!-- Invalid Packages Warning Banner -->
      <div id="invalid-packages-notification" class="hidden mb-6 bg-orange-50 dark:bg-orange-900 border border-orange-200 dark:border-orange-700 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <span class="text-2xl">🚫</span>
          <div class="flex-1">
            <h3 class="font-semibold text-orange-800 dark:text-orange-200 mb-1">
              Invalid Packages Detected
            </h3>
            <p class="text-sm text-orange-700 dark:text-orange-300 mb-2">
              <strong id="invalid-package-count">0</strong> packages in your <code class="px-1 py-0.5 bg-orange-100 dark:bg-orange-800 rounded">package.json</code> do not exist in the NPM registry (404 Not Found).
            </p>
            <p class="text-xs text-orange-600 dark:text-orange-400">
              ℹ️ These are likely typos, test packages, or unpublished packages. The health score is calculated based on <strong>real packages only</strong> to ensure accuracy.
            </p>
            <details class="mt-3">
              <summary class="cursor-pointer text-sm font-medium text-orange-700 dark:text-orange-300 hover:text-orange-900 dark:hover:text-orange-100">
                View invalid packages
              </summary>
              <ul id="invalid-packages-list" class="mt-2 ml-4 text-xs text-orange-600 dark:text-orange-400 space-y-1 max-h-40 overflow-y-auto">
                <!-- Populated by JavaScript -->
              </ul>
            </details>
          </div>
          <button id="close-invalid-notification" class="text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-200" aria-label="Close notification">
            ✕
          </button>
        </div>
      </div>
      
      <!-- Health + Cleanup Row -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 animate-fade-in">
        <!-- Health Score Card - Modern Circular Design -->
        <div id="health-score-card" class="health-score-card h-full flex flex-col">
          <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-6 flex items-center justify-center gap-2 shrink-0 text-center">
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
            </svg>
            Overall Health Score
          </h2>
          <div class="flex flex-col flex-1 w-full gap-4 items-center justify-center overflow-visible relative">
            <!-- Circle and Breakdown Row -->
            <div class="flex items-center justify-center gap-6 shrink-0">
              <!-- Circular Progress Ring - Left -->
              <div class="health-ring-wrapper shrink-0">
                <svg class="health-ring-svg transform -rotate-90">
                  <!-- Background circle -->
                  <circle cx="80" cy="80" r="70" stroke="currentColor" stroke-width="8" fill="none" class="text-gray-200 dark:text-gray-700"/>
                  <!-- Progress circle with gradient -->
                  <circle id="health-score-circle" cx="80" cy="80" r="70" stroke="url(#healthGradient)" stroke-width="10" fill="none" 
                          class="health-ring-progress" 
                          stroke-linecap="round" 
                          stroke-dasharray="440" 
                          stroke-dashoffset="440"/>
                  <!-- Gradient definition -->
                  <defs>
                    <linearGradient id="healthGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#6366f1"/>
                      <stop offset="50%" style="stop-color:#8b5cf6"/>
                      <stop offset="100%" style="stop-color:#06b6d4"/>
                    </linearGradient>
                  </defs>
                </svg>
                <!-- Score in center of ring -->
                <div class="health-ring-center">
                  <div class="flex items-baseline">
                  <span id="health-score-value" class="health-score-number shimmer-text">--</span>
                    <span class="text-3xl font-bold text-gray-600 dark:text-gray-400">%</span>
                  </div>
                  <p id="health-score-label" class="text-xs font-medium text-gray-500 dark:text-gray-400 mt-1">Loading...</p>
                </div>
              </div>
              
              <!-- Health Score Breakdown - Right -->
              <div id="health-score-breakdown" class="space-y-2 hidden shrink-0">
                <div class="flex items-center gap-3 text-xs">
                  <span class="text-gray-600 dark:text-gray-400 w-24 shrink-0">Security</span>
                  <div class="relative group flex items-center gap-1.5 flex-1 min-w-0">
                    <div class="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0">
                      <div id="health-score-security-bar" class="h-1.5 bg-red-500 rounded-full transition-all duration-500" style="width: 0%"></div>
                    </div>
                    <span id="health-score-security-value" class="font-semibold w-10 text-right text-xs shrink-0">--</span>
                    <div class="tooltip-bubble pointer-events-none absolute left-0 bottom-full mb-1 flex flex-col items-center transition-all duration-150 ease-out opacity-0 group-hover:opacity-100 z-50" style="width: 150%; right: -25%; max-width: calc(100vw - 4rem);" aria-hidden="true">
                      <div id="health-score-security-tooltip" class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 text-center w-full wrap-break-word">
                        Loading...
                      </div>
                      <div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-4 border-l-transparent border-r-transparent border-t-slate-900 -mt-px"></div>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-3 text-xs">
                  <span class="text-gray-600 dark:text-gray-400 w-24 shrink-0">Freshness</span>
                  <div class="relative group flex items-center gap-1.5 flex-1 min-w-0">
                    <div class="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0">
                      <div id="health-score-freshness-bar" class="h-1.5 bg-yellow-500 rounded-full transition-all duration-500" style="width: 0%"></div>
                    </div>
                    <span id="health-score-freshness-value" class="font-semibold w-10 text-right text-xs shrink-0">--</span>
                    <div class="tooltip-bubble pointer-events-none absolute left-0 bottom-full mb-1 flex flex-col items-center transition-all duration-150 ease-out opacity-0 group-hover:opacity-100 z-50" style="width: 150%; right: -25%; max-width: calc(100vw - 4rem);" aria-hidden="true">
                      <div id="health-score-freshness-tooltip" class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 text-center w-full wrap-break-word">
                        Loading...
                      </div>
                      <div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-4 border-l-transparent border-r-transparent border-t-slate-900 -mt-px"></div>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-3 text-xs">
                  <span class="text-gray-600 dark:text-gray-400 w-24 shrink-0">Compatibility</span>
                  <div class="relative group flex items-center gap-1.5 flex-1 min-w-0">
                    <div class="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0">
                      <div id="health-score-compatibility-bar" class="h-1.5 bg-orange-500 rounded-full transition-all duration-500" style="width: 0%"></div>
                    </div>
                    <span id="health-score-compatibility-value" class="font-semibold w-10 text-right text-xs shrink-0">--</span>
                    <div class="tooltip-bubble pointer-events-none absolute left-0 bottom-full mb-1 flex flex-col items-center transition-all duration-150 ease-out opacity-0 group-hover:opacity-100 z-50" style="width: 150%; right: -25%; max-width: calc(100vw - 4rem);" aria-hidden="true">
                      <div id="health-score-compatibility-tooltip" class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 text-center w-full wrap-break-word">
                        Loading...
                      </div>
                      <div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-4 border-l-transparent border-r-transparent border-t-slate-900 -mt-px"></div>
                    </div>
                  </div>
                </div>
                <div class="flex items-center gap-3 text-xs">
                  <span class="text-gray-600 dark:text-gray-400 w-24 shrink-0">License</span>
                  <div class="relative group flex items-center gap-1.5 flex-1 min-w-0">
                    <div class="w-16 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full shrink-0">
                      <div id="health-score-license-bar" class="h-1.5 bg-green-500 rounded-full transition-all duration-500" style="width: 0%"></div>
                    </div>
                    <span id="health-score-license-value" class="font-semibold w-10 text-right text-xs shrink-0">--</span>
                    <div class="tooltip-bubble pointer-events-none absolute left-0 bottom-full mb-1 flex flex-col items-center transition-all duration-150 ease-out opacity-0 group-hover:opacity-100 z-50" style="width: 150%; right: -25%; max-width: calc(100vw - 4rem);" aria-hidden="true">
                      <div id="health-score-license-tooltip" class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 text-center w-full wrap-break-word">
                        Loading...
                      </div>
                      <div class="w-0 h-0 border-l-[3px] border-r-[3px] border-t-4 border-l-transparent border-r-transparent border-t-slate-900 -mt-px"></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Stats below - Centered -->
            <div class="flex items-center justify-center gap-2 text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-4 py-2 rounded-full text-center">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M7 3a1 1 0 000 2h6a1 1 0 100-2H7zM4 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1zM2 11a2 2 0 012-2h12a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4z"/>
              </svg>
              <span id="total-deps-subscript">
                <span id="metric-total" class="font-semibold">--</span> dependencies analyzed
              </span>
            </div>
          </div>
        </div>

        <!-- Unused Dependencies Cleanup Card -->
        <div id="cleanup-card" class="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 h-full flex flex-col">
          <div class="flex items-start justify-between gap-4 mb-3">
            <div class="flex items-center gap-3">
              <div class="p-2 bg-purple-100 dark:bg-purple-900 rounded-lg">
                <svg
                  class="w-5 h-5 text-gray-700 dark:text-gray-200"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="6" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <path d="M20 4L8.12 15.88"/>
                  <path d="M14.47 14.48L20 20"/>
                  <path d="M8.12 8.12L12 12"/>
                </svg>
              </div>
              <div class="flex flex-col gap-0.5">
                <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                  Unused Dependencies
                </h3>
                <span class="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/60 text-[11px] font-bold text-gray-800 dark:text-gray-100 shadow-inner">
                    Knip
                  </span>
                  <span class="text-gray-600 dark:text-gray-300 font-medium">powered cleanup</span>
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2 sm:gap-3">
              <div class="relative group">
                <button
                  id="cleanup-preview-btn"
                  class="inline-flex items-center justify-center w-10 h-10 rounded-xl border-2 border-indigo-200/80 dark:border-indigo-800/70 bg-linear-to-br from-indigo-500 via-purple-500 to-blue-500 text-white shadow-md shadow-indigo-200/40 dark:shadow-indigo-900/50 hover:brightness-110 hover:scale-105 cursor-pointer active:translate-y-px transition-all duration-150 focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900"
                  type="button"
                  aria-label="Scan and preview unused dependencies"
                >
                  <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="4.5"/>
                    <path d="M11 6.25c2.623 0 4.75 2.127 4.75 4.75"/>
                    <path d="M11 7.75c1.795 0 3.25 1.455 3.25 3.25"/>
                    <path d="M15.5 15.5 19.5 19.5"/>
                    <path d="M9.25 11.25 11 13l2.25-2.75"/>
                  </svg>
                  <span id="cleanup-preview-label" class="sr-only">Scan unused dependencies</span>
                </button>
                <div class="tooltip-bubble pointer-events-none absolute left-1/2 -translate-x-1/2 -top-12 flex flex-col items-center transition-all duration-150 ease-out opacity-0 group-hover:opacity-100" aria-hidden="true">
                  <div class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 whitespace-nowrap">
                    Scan unused dependencies
                  </div>
                  <div class="h-2 w-2 rotate-45 bg-slate-900 -mt-1 border-r border-b border-white/10"></div>
                </div>
              </div>
              <div class="relative group">
                <button
                  id="cleanup-confirm-btn"
                  class="inline-flex items-center justify-center w-10 h-10 rounded-xl border-2 border-rose-200/80 dark:border-rose-800/70 bg-linear-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-200/60 dark:shadow-rose-900/60 hover:brightness-110 hover:scale-105 cursor-pointer active:translate-y-px transition-all duration-150 focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-900"
                  type="button"
                  aria-label="Remove unused dependencies after review"
                >
                  <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M6 7h12"/>
                    <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/>
                    <path d="M8 7v9a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V7"/>
                    <path d="M10.25 11.75 12 13.5l3-3.5"/>
                    <path d="M5 7h14"/>
                  </svg>
                  <span id="cleanup-confirm-label" class="sr-only">Remove unused dependencies</span>
                </button>
                <div class="tooltip-bubble pointer-events-none absolute left-1/2 -translate-x-1/2 -top-12 flex flex-col items-center transition-all duration-150 ease-out opacity-0 group-hover:opacity-100" aria-hidden="true">
                  <div class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 whitespace-nowrap">
                    Remove unused dependencies
                  </div>
                  <div class="h-2 w-2 rotate-45 bg-slate-900 -mt-1 border-r border-b border-white/10"></div>
                </div>
              </div>
            </div>
          </div>

          <div class="flex-1 flex flex-col gap-3">
            <div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Remove unused dependencies</h3>
              <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">
                Scan with knip, see the preview, and remove after you confirm.
              </p>
            </div>

            <div
              id="cleanup-steps"
              class="flex items-stretch justify-between gap-3 md:gap-4 mt-1 flex-nowrap overflow-x-auto pb-1"
            >
              <div class="flex-1 min-w-65 md:min-w-0 p-3 md:p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-linear-to-br from-white/90 to-slate-50/80 dark:from-slate-900/70 dark:to-slate-900/40 flex flex-col gap-1.5 items-start shadow-sm hover:shadow-md transition-all duration-200">
                <div class="text-[11px] font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-200">Step 1</div>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">Detect</p>
                <p class="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                  Run knip to discover unused dependencies in each project.
                </p>
              </div>

              <div class="flex items-center justify-center text-slate-400 dark:text-slate-500 px-1">
                <svg class="w-6 h-6 md:w-6 md:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 12h14"/>
                  <path d="M13 5l7 7-7 7"/>
                </svg>
              </div>

              <div class="flex-1 min-w-65 md:min-w-0 p-3 md:p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-linear-to-br from-white/90 to-slate-50/80 dark:from-slate-900/70 dark:to-slate-900/40 flex flex-col gap-1.5 items-start shadow-sm hover:shadow-md transition-all duration-200">
                <div class="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">Step 2</div>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">Review</p>
                <p class="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                  Preview per-project removals before anything changes.
                </p>
              </div>

              <div class="flex items-center justify-center text-slate-400 dark:text-slate-500 px-1">
                <svg class="w-6 h-6 md:w-6 md:h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M5 12h14"/>
                  <path d="M13 5l7 7-7 7"/>
                </svg>
              </div>

              <div class="flex-1 min-w-65 md:min-w-0 p-3 md:p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-linear-to-br from-white/90 to-slate-50/80 dark:from-slate-900/70 dark:to-slate-900/40 flex flex-col gap-1.5 items-start shadow-sm hover:shadow-md transition-all duration-200">
                <div class="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">Step 3</div>
                <p class="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">Confirm</p>
                <p class="text-xs text-slate-600 dark:text-slate-300 leading-snug">
                  One click to remove the unused dependencies via your manager.
                </p>
              </div>
            </div>

            <div
              id="cleanup-detail"
              class="hidden mt-2 max-h-48 overflow-y-auto overflow-hidden space-y-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700"
            >
              <div class="sticky top-0 flex items-center justify-start gap-3 px-3 py-3 bg-slate-50/95 dark:bg-slate-900/95 border-b border-slate-200 dark:border-slate-700">
                <span
                  id="cleanup-count"
                  class="inline-flex items-center gap-2 text-sm font-semibold text-purple-800 dark:text-purple-100"
                >
                  0 unused dependencies
                </span>
                <button
                  id="cleanup-reset-btn"
                  class="text-xs font-semibold text-blue-700 dark:text-blue-300 hover:underline focus:outline-none cursor-pointer"
                  type="button"
                >
                  Reset
                </button>
              </div>
              <ul
                id="cleanup-list"
                class="space-y-2 list-none text-sm text-gray-700 dark:text-gray-300 pb-3 px-3"
              ></ul>
            </div>
          </div>

          <div id="cleanup-status" class="mt-3 text-sm text-gray-700 dark:text-gray-200"></div>
        </div>
      </div>

      <!-- Metric Cards - Modern Tremor-inspired Design -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 animate-fade-in">
        <!-- Critical Issues Card -->
        <div class="metric-card metric-card-critical group">
          <div class="metric-card-accent metric-card-accent-critical"></div>
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Critical
            </div>
            <div class="metric-card-icon metric-card-icon-critical">
              <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
              </svg>
            </div>
          </div>
          <div class="flex items-baseline justify-between">
            <div id="metric-critical" class="metric-value metric-value-critical shimmer-text">--</div>
            <canvas id="sparkline-critical" class="w-16 h-8" width="64" height="32"></canvas>
          </div>
          <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span id="metric-critical-trend" class="font-medium">No change</span>
          </div>
        </div>

        <!-- High Issues Card -->
        <div class="metric-card metric-card-high group">
          <div class="metric-card-accent metric-card-accent-high"></div>
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              High
            </div>
            <div class="metric-card-icon metric-card-icon-high">
              <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
              </svg>
            </div>
          </div>
          <div class="flex items-baseline justify-between">
            <div id="metric-high" class="metric-value metric-value-high shimmer-text">--</div>
            <canvas id="sparkline-high" class="w-16 h-8" width="64" height="32"></canvas>
          </div>
          <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span id="metric-high-trend" class="font-medium">No change</span>
          </div>
        </div>

        <!-- Outdated Packages Card -->
        <div class="metric-card metric-card-outdated group">
          <div class="metric-card-accent metric-card-accent-outdated"></div>
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Outdated
            </div>
            <div class="metric-card-icon metric-card-icon-outdated">
              <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
              </svg>
            </div>
          </div>
          <div class="flex items-baseline justify-between">
            <div id="metric-outdated" class="metric-value metric-value-outdated shimmer-text">--</div>
            <canvas id="sparkline-outdated" class="w-16 h-8" width="64" height="32"></canvas>
          </div>
          <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span id="metric-outdated-trend" class="font-medium">No change</span>
          </div>
        </div>

        <!-- Healthy Packages Card -->
        <div class="metric-card metric-card-healthy group">
          <div class="metric-card-accent metric-card-accent-healthy"></div>
          <div class="flex items-center justify-between mb-3">
            <div class="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
              Healthy
            </div>
            <div class="metric-card-icon metric-card-icon-healthy">
              <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
              </svg>
            </div>
          </div>
          <div class="flex items-baseline justify-between">
            <div id="metric-healthy" class="metric-value metric-value-healthy shimmer-text">--</div>
            <canvas id="sparkline-healthy" class="w-16 h-8" width="64" height="32"></canvas>
          </div>
          <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            <span id="metric-healthy-trend" class="font-medium">No change</span>
          </div>
        </div>
      </div>

      <!-- Charts Section - Modern Data Visualization -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <!-- Severity Distribution - Stacked Bar -->
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 animate-fade-in">
          <div class="flex items-center gap-2 mb-4">
            <div class="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
              <svg class="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
              </svg>
            </div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">Severity</h3>
          </div>
          <div class="relative h-48 max-h-48">
            <canvas id="severity-chart" role="img" aria-label="Severity distribution stacked bar chart"></canvas>
          </div>
        </div>

        <!-- Freshness Distribution - Bar Chart -->
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 animate-fade-in" style="animation-delay: 0.1s">
          <div class="flex items-center gap-2 mb-4">
            <div class="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
              <svg class="w-5 h-5 text-green-600 dark:text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/>
              </svg>
            </div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">Freshness</h3>
          </div>
          <div class="relative h-48 max-h-48">
            <canvas id="freshness-chart" role="img" aria-label="Freshness distribution bar chart"></canvas>
          </div>
        </div>

        <!-- CVSS Score Distribution - Histogram -->
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-lg p-6 border border-gray-200 dark:border-gray-700 transition-all duration-300 animate-fade-in" style="animation-delay: 0.2s">
          <div class="flex items-center gap-2 mb-4">
            <div class="p-2 bg-orange-100 dark:bg-orange-900 rounded-lg">
              <svg class="w-5 h-5 text-orange-600 dark:text-orange-400" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/>
              </svg>
            </div>
            <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100">CVSS Scores</h3>
          </div>
          <div class="relative h-48 max-h-48">
            <canvas id="cvss-chart" role="img" aria-label="CVSS score distribution histogram"></canvas>
          </div>
        </div>
      </div>

      <!-- Filters & Search Section -->
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-5 mb-6 border border-gray-200/50 dark:border-gray-700/50 backdrop-blur-sm" role="search" aria-label="Filter and search dependencies">
        <!-- Active Filter Pills -->
        <div id="active-filters-container" class="flex flex-wrap gap-2 mb-4" hidden>
          <!-- Filter pills dynamically inserted here -->
        </div>
        
        <!-- Modern Filter Bar -->
        <div class="flex flex-col xl:flex-row gap-3 xl:gap-4 items-stretch xl:items-center">
          <!-- Left side: Search and Filters -->
          <div class="flex flex-col sm:flex-row gap-2 sm:gap-3 flex-1 min-w-0">
            <input type="search" 
                   id="search-input" 
                   placeholder="Search dependencies, vulnerability IDs, severity, freshness..." 
                   aria-label="Search dependencies by name, vulnerability ID (CVE/GHSA), severity, or freshness"
                   class="flex-1 min-w-0 px-3 sm:px-4 py-2 sm:py-2.5 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm sm:text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm">
            
            <div class="relative shrink-0">
              <select id="severity-filter" 
                      aria-label="Filter by severity level"
                      class="dropdown-select w-full sm:w-auto bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm sm:text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm min-w-35 sm:min-w-40">
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">None</option>
              </select>
              <svg class="select-chevron text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 12 12">
                <path d="M2 4L6 8L10 4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            
            <div class="relative shrink-0">
              <select id="freshness-filter" 
                      aria-label="Filter by freshness level"
                      class="dropdown-select w-full sm:w-auto bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm sm:text-base text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm min-w-40 sm:min-w-45">
                <option value="all">All Freshness</option>
                <option value="current">Current</option>
                <option value="patch">Patch</option>
                <option value="minor">Minor</option>
                <option value="major">Major</option>
                <option value="unmaintained">Unmaintained</option>
              </select>
              <svg class="select-chevron text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 12 12">
                <path d="M2 4L6 8L10 4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
          
          <!-- Right side: Per-Page and Clear Filters -->
          <div class="flex items-center gap-2 sm:gap-3 shrink-0 justify-end xl:ml-auto">
            <!-- Modern Per-Page Dropdown (Right-aligned) -->
            <div class="flex items-center gap-1.5 sm:gap-2">
              <label for="per-page-select" class="text-xs sm:text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Per page:</label>
              <div class="relative">
                <select id="per-page-select" 
                        class="dropdown-select w-full sm:w-auto bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg text-sm sm:text-base text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm min-w-17.5 sm:min-w-20">
                  <option value="10" selected>10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                </select>
                <svg class="select-chevron text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 12 12">
                  <path d="M2 4L6 8L10 4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
            </div>
            
            <!-- Clear Filters Button -->
            <button id="clear-filters-btn" 
                    aria-label="Clear all active filters"
                    class="hidden px-3 sm:px-4 py-2 text-sm sm:text-base bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-lg font-medium transition-colors shadow-sm whitespace-nowrap">
              Clear
            </button>
          </div>
        </div>
        
        <!-- Filter Badge (if filters are active) -->
        <div class="flex items-center gap-3 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <span id="filter-badge" class="hidden px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-sm font-medium"></span>
        </div>
      </div>

      <!-- Data Table -->
      <div class="mt-6 rounded-2xl border border-gray-200/70 dark:border-gray-700/70 bg-white dark:bg-gray-900/70 shadow-[0px_18px_45px_rgba(15,23,42,0.08)] overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200/60 dark:border-gray-800/70 bg-linear-to-r from-gray-50/70 via-white to-white dark:from-gray-900/60 dark:via-gray-900/40">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p class="text-xs font-medium text-gray-500 dark:text-gray-400 tracking-wider opacity-75">Project's Dependency Insights</p>
            </div>
          </div>
        </div>
        <div class="relative">
          <div id="table-scroll-region" class="overflow-x-auto max-h-130 scroll-smooth">
            <table class="min-w-full text-sm text-gray-900 dark:text-gray-100" role="table" aria-label="Dependencies table">
              <thead class="sticky top-0 z-10 border-b border-gray-200/70 dark:border-gray-800/70 bg-white/95 dark:bg-gray-900/95 backdrop-blur text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <tr role="row">
                  <th scope="col" class="px-6 py-3 text-left cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="packageName">
                    <div class="flex items-center gap-3">
                      <input type="checkbox" id="select-all" class="smart-checkbox-input shrink-0 self-center -ml-2" aria-label="Select all dependencies" onclick="event.stopPropagation()">
                      <span class="flex items-center gap-1">Package <span class="sort-indicator"></span></span>
                    </div>
                  </th>
                  <th scope="col" class="px-6 py-3 text-left">
                    Vulnerabilities
                  </th>
                  <th scope="col" class="px-6 py-3 text-left cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="severity">
                    Severity <span class="sort-indicator ml-1"></span>
                  </th>
                  <th scope="col" class="px-6 py-3 text-left">
                    Freshness
                  </th>
                  <th scope="col" class="px-6 py-3 text-center cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="cvssScore">
                    CVSS <span class="sort-indicator ml-1"></span>
                  </th>
                  <th scope="col" class="px-6 py-3 text-left">
                    Current
                  </th>
                  <th scope="col" class="px-6 py-3 text-left">
                    Latest
                  </th>
                  <th scope="col" class="px-6 py-3 text-left cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="lastUpdated">
                    Last Updated <span class="sort-indicator ml-1"></span>
                  </th>
                  <th scope="col" class="px-6 py-3 text-left">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody id="dependency-table-body" class="bg-white dark:bg-transparent divide-y divide-gray-100 dark:divide-gray-800" role="rowgroup">
                <!-- Table rows will be inserted here -->
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- Bulk Update Button -->
        <div id="bulk-update-container" class="px-6 py-4 bg-blue-50/80 dark:bg-blue-900/10 border-t border-blue-100 dark:border-blue-900/40 flex items-center justify-between" hidden>
          <p class="text-sm font-medium text-blue-700 dark:text-blue-300">
            <span id="selected-total">0</span> <span id="selected-total-label">packages</span> selected, 
            <span id="selected-count">0</span> <span id="selected-count-label">need updates</span>
          </p>
          <button id="bulk-update-btn" 
                  aria-label="Update all selected dependencies"
                  aria-describedby="selected-count"
                  class="modern-btn modern-btn-primary">
            Run bulk update
          </button>
        </div>
        

        <!-- Pagination -->
        <div class="px-6 py-4 bg-gray-50/70 dark:bg-gray-900/60 border-t border-gray-200/70 dark:border-gray-800/70 flex items-center justify-between flex-wrap gap-3" role="navigation" aria-label="Table pagination">
          <div class="text-sm text-gray-700 dark:text-gray-300">
            <span id="pagination-info" aria-live="polite">Showing 0-0 of 0 dependencies</span>
          </div>
          <div class="flex items-center gap-3">

            <button id="prev-page-btn" 
                    aria-label="Go to previous page" 
                    class="px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                    disabled>
              ← Previous
            </button>
            <span id="page-indicator" class="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-full border border-gray-200 dark:border-gray-700" aria-live="polite">Page 1 of 1</span>
            <button id="next-page-btn" 
                    aria-label="Go to next page"
                    class="px-4 py-2 rounded-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                    disabled>
              Next →
            </button>
          </div>
        </div>
      </div>

      <!-- Card Grid View (hidden by default) -->
      <div id="card-grid-view" class="hidden">
        <div id="dependency-card-grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          <!-- Cards will be inserted here dynamically -->
        </div>
        
        <!-- Card View Pagination -->
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-md p-4 border border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-3" role="navigation" aria-label="Card pagination">
          <div class="text-sm text-gray-700 dark:text-gray-300">
            <span id="card-pagination-info" aria-live="polite">Showing 0-0 of 0 dependencies</span>
          </div>
          <div class="flex gap-2">
            <button id="card-prev-page-btn" 
                    aria-label="Go to previous page" 
                    class="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    disabled>
              ← Previous
            </button>
            <span id="card-page-indicator" class="px-3 py-1 text-sm text-gray-700 dark:text-gray-300" aria-live="polite">Page 1 of 1</span>
            <button id="card-next-page-btn" 
                    aria-label="Go to next page"
                    class="px-3 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    disabled>
              Next →
            </button>
          </div>
        </div>
      </div>

      <!-- Timeline View -->
      <div id="timeline-view" class="hidden">
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6 border border-gray-200 dark:border-gray-700 mb-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Vulnerability Timeline</h3>
          <div id="timeline-container" class="relative min-h-100">
            <!-- Timeline will be rendered here -->
          </div>
        </div>
      </div>

      <!-- Heatmap View -->
      <div id="heatmap-view" class="hidden">
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6 border border-gray-200 dark:border-gray-700 mb-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Package Health Heatmap</h3>
          <div id="heatmap-container" class="overflow-x-auto min-h-100">
            <!-- Heatmap will be rendered here -->
          </div>
        </div>
      </div>

      <!-- Comparison View -->
      <div id="comparison-view" class="hidden">
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-md p-6 border border-gray-200 dark:border-gray-700 mb-6">
          <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Package Comparison</h3>
          <div class="mb-4 flex flex-wrap gap-2">
            <button id="select-comparison-packages" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors">
              Select Packages to Compare
            </button>
            <span id="selected-packages-count" class="px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm text-gray-700 dark:text-gray-300">
              0 packages selected
            </span>
          </div>
          <div id="comparison-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 min-h-50">
            <!-- Comparison cards will be rendered here -->
          </div>
        </div>
      </div>

      <!-- Error Container -->
      <div id="error-container" class="fixed inset-0 glass-overlay z-50 flex items-center justify-center animate-fade-in" hidden>
        <!-- Error content will be dynamically inserted by JavaScript -->
      </div>
    </div>

    <!-- Loading Overlay - Outside dashboard-content for full page coverage -->
    <div id="loading-overlay" class="fixed inset-0 glass-overlay z-50 flex items-center justify-center animate-fade-in" hidden>
      <div class="glass-modal rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 animate-scale-up">
        <div class="text-center">
          <!-- Spinner Animation -->
          <div class="inline-block animate-spin rounded-full h-16 w-16 border-4 border-gray-200 dark:border-gray-700 border-t-blue-600 dark:border-t-blue-500 mb-4"></div>
          
          <!-- Loading Text -->
          <h3 id="loading-text" class="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Analyzing dependencies...
          </h3>
          
          <!-- Progress Indicator (optional, shown if progress data available) -->
          <div id="loading-progress" class="hidden mt-4">
            <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-2">
              <div id="loading-progress-bar" class="bg-blue-600 dark:bg-blue-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
            <p id="loading-progress-text" class="text-sm text-gray-600 dark:text-gray-400">0%</p>
          </div>
          
          <!-- Loading Details -->
          <p class="text-sm text-gray-600 dark:text-gray-400 mt-2">
            This may take a few moments...
          </p>
        </div>
      </div>
    </div>


      <!-- Chart Loading Placeholders -->
      <div id="chart-skeleton" class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6" hidden>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
          <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4 animate-pulse"></div>
          <div class="w-full h-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border border-gray-200 dark:border-gray-700">
          <div class="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4 animate-pulse"></div>
          <div class="w-full h-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"></div>
        </div>
      </div>

      <!-- Empty State: No Dependencies -->
      <div id="empty-state-no-deps" class="flex flex-col items-center justify-center min-h-125 p-12 text-center" role="status" aria-live="polite" hidden>
        <div class="text-8xl mb-6" role="img" aria-label="Package icon">📦</div>
        <h2 class="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
          No Dependencies Found
        </h2>
        <p class="text-lg text-gray-600 dark:text-gray-400 mb-6 max-w-md">
          We couldn't find any dependencies in your project. Make sure you have a package.json file with dependencies listed.
        </p>
        <button id="scan-now-btn" 
                aria-label="Scan for dependencies now"
                class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors flex items-center gap-2">
          <span role="img" aria-label="Search icon">🔍</span>
          <span>Scan Now</span>
        </button>
      </div>

      <!-- Empty State: All Healthy -->
      <div id="empty-state-healthy" class="flex flex-col items-center justify-center min-h-125 p-12 text-center" role="status" aria-live="polite" hidden>
        <div class="text-8xl mb-6" role="img" aria-label="Success checkmark">✅</div>
        <h2 class="text-3xl font-bold text-green-600 dark:text-green-400 mb-3">
          All Dependencies Healthy!
        </h2>
        <p class="text-lg text-gray-600 dark:text-gray-400 mb-6 max-w-md">
          Congratulations! All your dependencies are up-to-date and secure. No vulnerabilities detected.
        </p>
        <div class="flex gap-4">
          <button id="refresh-from-healthy-btn" 
                  aria-label="Refresh dependency analysis"
                  class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors">
            Refresh Analysis
          </button>
          <button id="view-details-btn" 
                  aria-label="View detailed dependency information"
                  class="px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-md font-medium transition-colors">
            View Details
          </button>
        </div>
      </div>

      <!-- Screen Reader Announcements -->
      <div id="sr-announcements" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
  </div>

  <!-- Dashboard Modules (load in dependency order) -->
  <script nonce="${nonce}" src="${stateScriptUri}"></script>
  <script nonce="${nonce}" src="${utilsScriptUri}"></script>
  <script nonce="${nonce}" src="${chartsScriptUri}"></script>
  <script nonce="${nonce}" src="${filtersScriptUri}"></script>
  <script nonce="${nonce}" src="${tableScriptUri}"></script>
  <script nonce="${nonce}" src="${coreScriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Dispose of the webview manager and clean up resources
   */
  public dispose(): void {
    if (this.panel) {
      this.panel.dispose();
    }

    // Dispose all disposables
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];

    // Clear timeout
    if (this.readyTimeout) {
      clearTimeout(this.readyTimeout);
      this.readyTimeout = null;
    }

    this.log('DashboardWebviewManager disposed');
  }
}
