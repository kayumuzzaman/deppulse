// DepPulse Dashboard - Core Initialization and Message Handling
// Main dashboard coordination, initialization, and message handling

// Acquire VS Code API (only once)
var vscode = window.vscode || acquireVsCodeApi();
window.vscode = vscode;

// Global cache state - accessible by all event handlers
let cacheEnabled = false; // Default to false to match safe default

// Store event listener references for cleanup
const eventListeners = {
  message: null,
  scroll: null,
  resize: null,
  DOMContentLoaded: null,
};

/**
 * Sanitize user-provided text to prevent XSS
 * Uses textContent to escape HTML entities
 */
function sanitizeText(text) {
  if (typeof text !== 'string') {
    return String(text);
  }
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Note: This module depends on all other dashboard modules:
// - dashboard-state.js (state variables)
// - dashboard-utils.js (utility functions)
// - dashboard-charts.js (chart rendering)
// - dashboard-filters.js (filtering)
// - dashboard-table.js (table/card rendering)

// Cleanup function to remove all event listeners and clear intervals
function cleanupEventListeners() {
  // Clear timestamp interval
  if (window.timestampUpdateInterval) {
    clearInterval(window.timestampUpdateInterval);
    window.timestampUpdateInterval = null;
  }

  // Clear refresh timeout
  if (window.refreshTimeout) {
    clearTimeout(window.refreshTimeout);
    window.refreshTimeout = null;
  }

  // Remove event listeners if they exist
  if (eventListeners.message) {
    window.removeEventListener('message', eventListeners.message);
    eventListeners.message = null;
  }
  if (eventListeners.scroll) {
    window.removeEventListener('scroll', eventListeners.scroll);
    eventListeners.scroll = null;
  }
  if (eventListeners.resize) {
    window.removeEventListener('resize', eventListeners.resize);
    eventListeners.resize = null;
  }
  if (eventListeners.DOMContentLoaded) {
    window.removeEventListener('DOMContentLoaded', eventListeners.DOMContentLoaded);
    eventListeners.DOMContentLoaded = null;
  }
}

// Store cleanup function globally for potential external calls
window.__depPulseCleanup = cleanupEventListeners;

// Cleanup on page unload (defensive)
window.addEventListener('beforeunload', cleanupEventListeners);

const domContentLoadedHandler = () => {
  Logger.log('[Dashboard] Webview loaded, sending ready signal to extension');
  vscode.postMessage({ command: 'ready' });
  initializeStickyHeader();

  // Initialize refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Prevent multiple clicks - check if already disabled/scanning
      if (refreshBtn.disabled) {
        Logger.log('[Dashboard] Refresh already in progress, ignoring click');
        return;
      }

      // Show loading overlay immediately (ensures modal is visible even for quick scans)
      showLoadingOverlay('Starting Analysis...', 0);

      // Disable refresh button immediately to prevent multiple clicks
      refreshBtn.disabled = true;
      refreshBtn.classList.add('opacity-50', 'cursor-not-allowed');

      // Show spinner on button
      const refreshIcon = document.getElementById('refresh-icon');
      if (refreshIcon) {
        refreshIcon.classList.add('spinning');
      }

      // Calculate dynamic timeout based on last known package count
      // Formula: baseTime + (packageCount × timePerPackage) × safetyMultiplier
      const baseTime = 30000; // 30s base overhead (parsing, setup, etc.)
      const timePerPackage = 150; // 150ms per package (conservative estimate)
      const safetyMultiplier = 2.0; // 2x safety margin
      const minTimeout = 60000; // Minimum 60s timeout
      const maxTimeout = 600000; // Maximum 10 minutes timeout

      // Use last known package count, or default to 200 packages if unknown
      const estimatedPackageCount = window.lastScanPackageCount || 200;
      const estimatedTime = baseTime + estimatedPackageCount * timePerPackage;
      const calculatedTimeout = Math.min(
        maxTimeout,
        Math.max(minTimeout, estimatedTime * safetyMultiplier)
      );

      // Log timeout calculation for debugging
      Logger.log(
        `[Dashboard] Calculated timeout: ${calculatedTimeout}ms for ~${estimatedPackageCount} packages`
      );

      // Set timeout to re-enable button if no response
      if (window.refreshTimeout) {
        clearTimeout(window.refreshTimeout);
      }

      window.refreshTimeout = setTimeout(() => {
        const timeoutSeconds = Math.round(calculatedTimeout / 1000);
        Logger.warn(`Refresh timeout - no response received after ${timeoutSeconds} seconds`);
        hideLoadingOverlay();

        // Re-enable refresh button
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        }

        const refreshIcon = document.getElementById('refresh-icon');
        if (refreshIcon) {
          refreshIcon.classList.remove('spinning');
        }

        // Show error message
        errorHandler.showError(
          `Refresh timed out after ${timeoutSeconds} seconds. Please check the output logs for details.`
        );
      }, calculatedTimeout);

      // Send refresh command to extension
      // If cache is disabled, force refresh (bypass cache)
      const forceRefresh = !cacheEnabled;
      Logger.log(
        '[Dashboard] Refresh button clicked - cacheEnabled:',
        cacheEnabled,
        'forceRefresh:',
        forceRefresh
      );
      vscode.postMessage({
        command: 'refresh',
        data: { force: forceRefresh },
      });
    });
  }

  const cacheToggleBtn = document.getElementById('toggle-cache-btn');
  if (cacheToggleBtn) {
    cacheToggleBtn.addEventListener('click', () => {
      // Toggle cache state
      cacheEnabled = !cacheEnabled;
      updateCacheToggleUI(cacheEnabled);

      // Send toggle command to extension
      vscode.postMessage({ command: 'depPulse.toggleCache' });
    });
  }

  // Empty state: Scan Now button
  const scanNowBtn = document.getElementById('scan-now-btn');
  if (scanNowBtn) {
    scanNowBtn.addEventListener('click', () => {
      showLoadingOverlay('Scanning for dependencies...', 0);
      vscode.postMessage({ command: 'refresh' });
    });
  }

  // Empty state: Refresh from healthy state
  const refreshFromHealthyBtn = document.getElementById('refresh-from-healthy-btn');
  if (refreshFromHealthyBtn) {
    refreshFromHealthyBtn.addEventListener('click', () => {
      showLoadingOverlay('Refreshing analysis...', 0);
      vscode.postMessage({ command: 'refresh' });
    });
  }

  // Export button with dropdown
  const exportBtn = document.getElementById('export-btn');
  const exportMenu = document.getElementById('export-menu');
  const exportJsonBtn = document.getElementById('export-json');
  const exportCsvBtn = document.getElementById('export-csv');

  if (exportBtn && exportMenu) {
    exportBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('hidden');
    });

    // Close menu when clicking outside
    document.addEventListener('click', () => {
      if (exportMenu && !exportMenu.classList.contains('hidden')) {
        exportMenu.classList.add('hidden');
      }
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      exportReport('json');
      if (exportMenu) exportMenu.classList.add('hidden');
    });
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      exportReport('csv');
      if (exportMenu) exportMenu.classList.add('hidden');
    });
  }

  // Initialize filter event listeners
  initializeFilters();

  // Delegate event listeners for dynamically generated table rows and action buttons
  document.addEventListener('click', (e) => {
    // Handle buttons with data-action attribute
    const actionBtn = e.target.closest('[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      const packageName = actionBtn.dataset.package;
      const rowKey = actionBtn.dataset.rowKey || packageName;

      switch (action) {
        case 'toggle-cves':
          if (typeof tableManager !== 'undefined' && tableManager) {
            tableManager.toggleCVEExpansion(rowKey);
          }
          break;
        case 'view-vulns':
          if (typeof tableManager !== 'undefined' && tableManager) {
            tableManager.showVulnerabilities(rowKey, packageName);
          }
          break;
        case 'copy-package': {
          const value = actionBtn.dataset.value || packageName;
          if (typeof copyTextToClipboard === 'function') {
            copyTextToClipboard(
              value,
              actionBtn.dataset.announce || 'Package name copied to clipboard'
            );
          }
          break;
        }
        case 'copy-install':
          if (typeof copyTextToClipboard === 'function') {
            copyTextToClipboard(
              actionBtn.dataset.value,
              actionBtn.dataset.announce || 'Install command copied to clipboard'
            );
          }
          break;
        case 'open-settings':
          if (typeof openDepPulseSettings === 'function') {
            openDepPulseSettings(
              actionBtn.dataset.settingKey,
              actionBtn.dataset.provider,
              actionBtn.dataset.scope
            );
          }
          break;
        case 'open-link':
          if (typeof openExternalLink === 'function') {
            openExternalLink(actionBtn.dataset.url, actionBtn.dataset.announce);
          }
          break;
        case 'retry-analysis':
          errorHandler.handleRetry();
          break;
        case 'view-logs':
          errorHandler.viewLogs();
          break;
        case 'reset-llm-config':
          if (typeof resetLlmConfig === 'function') {
            resetLlmConfig();
          }
          break;
        case 'view-transitive':
          if (typeof tableManager !== 'undefined' && tableManager) {
            tableManager.showTransitiveDependencies(rowKey, packageName);
          }
          break;
        default:
          break;
      }

      e.stopPropagation();
      return;
    }

    // Handle row checkbox
    if (e.target.classList.contains('row-checkbox')) {
      const rowKey = e.target.dataset.rowKey || e.target.dataset.package;
      Logger.log('[Dashboard] Row checkbox clicked for:', rowKey);
      // Try multiple ways to access tableManager
      const manager =
        window.__depPulseTableManager ||
        (typeof tableManager !== 'undefined' ? tableManager : null) ||
        window.tableManager;
      if (manager) {
        Logger.log('[Dashboard] Calling toggleRowSelection on manager');
        manager.toggleRowSelection(rowKey);
      } else {
        Logger.error('[Dashboard] tableManager not found!', {
          hasDepPulse: !!window.__depPulseTableManager,
          hasTableManager: typeof tableManager !== 'undefined',
          hasWindowTableManager: !!window.tableManager,
        });
      }
      e.stopPropagation();
      return;
    }

    if (e.target.id === 'select-all') {
      e.stopPropagation();
      return;
    }

    // Handle update button
    if (e.target.classList.contains('update-btn') || e.target.closest('.update-btn')) {
      e.stopPropagation(); // Prevent row expansion
      e.preventDefault(); // Prevent default action
      const btn = e.target.classList.contains('update-btn')
        ? e.target
        : e.target.closest('.update-btn');
      const packageName = btn.dataset.package;
      const version = btn.dataset.version;
      const workspaceFolder = btn.dataset.workspace;
      const packageRoot = btn.dataset.packageRoot || btn.dataset.packageroot;
      Logger.log('[Dashboard] Update button clicked:', packageName, version);
      if (packageName && version) {
        vscode.postMessage({
          command: 'updateDependency',
          data: { name: packageName, version, workspaceFolder, packageRoot },
        });
      }
      return; // Don't process other handlers
    }

    // Handle sortable column headers
    const sortableHeader = e.target.closest('[data-sort]');
    if (sortableHeader) {
      const column = sortableHeader.dataset.sort;
      if (typeof tableManager !== 'undefined' && tableManager) {
        tableManager.sortBy(column);
      }
      return; // Don't process row expansion
    }

    // Expand via dedicated toggle
    const expandToggle = e.target.closest('.expand-toggle-modern');
    if (expandToggle) {
      const rowKey = expandToggle.dataset.rowKey || expandToggle.dataset.package;
      if (typeof tableManager !== 'undefined' && tableManager) {
        tableManager.toggleRowExpansion(rowKey);
      }
      return;
    }

    const expandedTab = e.target.closest('.expanded-tab');
    if (expandedTab) {
      e.stopPropagation();
      if (typeof window.switchExpandedTab === 'function') {
        window.switchExpandedTab(
          e,
          expandedTab.dataset.rowKey,
          expandedTab.dataset.tab,
          expandedTab.dataset.package
        );
      }
      return;
    }

    // Handle row expansion via row click (ignore interactive elements)
    const rowMain = e.target.closest('.row-main');
    if (
      rowMain &&
      !e.target.closest('button') &&
      !e.target.closest('a') &&
      !e.target.closest('input')
    ) {
      const rowKey = rowMain.dataset.rowKey || rowMain.dataset.package;
      if (typeof tableManager !== 'undefined' && tableManager) {
        tableManager.toggleRowExpansion(rowKey);
      }
    }
  });
};

// Add DOMContentLoaded listener and store reference
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', domContentLoadedHandler);
  eventListeners.DOMContentLoaded = domContentLoadedHandler;
} else {
  // DOM already loaded, execute immediately
  domContentLoadedHandler();
}

// Helper to update cache toggle UI - Global scope so renderDashboard can access it
function updateCacheToggleUI(enabled) {
  // Update local state
  cacheEnabled = enabled;

  const cacheVisual = document.getElementById('cache-toggle-visual');
  const cacheKnob = document.getElementById('cache-toggle-knob');
  const cacheText = document.getElementById('cache-toggle-text');

  if (cacheVisual && cacheKnob && cacheText) {
    if (enabled) {
      // Enabled state
      cacheVisual.classList.remove('bg-gray-200', 'dark:bg-gray-700');
      cacheVisual.classList.add('bg-blue-600');

      cacheKnob.classList.remove('translate-x-0');
      cacheKnob.classList.add('translate-x-3');

      cacheText.textContent = 'Cache On';
    } else {
      // Disabled state
      cacheVisual.classList.add('bg-gray-200', 'dark:bg-gray-700');
      cacheVisual.classList.remove('bg-blue-600');

      cacheKnob.classList.add('translate-x-0');
      cacheKnob.classList.remove('translate-x-3');

      cacheText.textContent = 'Cache Off';
    }
  }
}

/**
 * Dark Mode Detection and Management
 * Detects VS Code theme and applies dark mode class
 */
function detectTheme() {
  const body = document.body;
  const isDark =
    body.classList.contains('vscode-dark') || body.classList.contains('vscode-high-contrast');

  if (isDark) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  // Re-render charts with updated colors when theme changes
  if (window.currentDashboardData && window.currentDashboardData.chartData) {
    renderSeverityChart(window.currentDashboardData.chartData.severity);
    renderFreshnessChart(window.currentDashboardData.chartData.freshness);
  }
}

// Watch for theme changes
const themeObserver = new MutationObserver(detectTheme);
themeObserver.observe(document.body, {
  attributes: true,
  attributeFilter: ['class'],
});

// Initial theme detection
detectTheme();

// Store message listener reference
const messageListener = (event) => {
  const message = event.data;
  Logger.log('[Dashboard] ===== MESSAGE RECEIVED =====');
  Logger.log('[Dashboard] Message type:', message.type);
  Logger.log('[Dashboard] Full message:', message);

  // Persisted offline banner state
  if (typeof window.offlineSticky === 'undefined') {
    window.offlineSticky = false;
    window.offlineMessage = '';
  }

  switch (message.type) {
    case 'analysisUpdate': {
      Logger.log(
        '[Dashboard] ===== ANALYSIS UPDATE RECEIVED =====',
        message.data?.dependencies?.length,
        'dependencies'
      );
      Logger.log('[Dashboard] Full message received:', JSON.stringify(message).substring(0, 500));
      Logger.log('[Dashboard] Full data received:', {
        hasDependencies: !!message.data?.dependencies,
        dependenciesLength: message.data?.dependencies?.length,
        dependenciesType: typeof message.data?.dependencies,
        isArray: Array.isArray(message.data?.dependencies),
        firstDep: message.data?.dependencies?.[0],
        hasHealthScore: !!message.data?.healthScore,
        hasMetrics: !!message.data?.metrics,
        hasChartData: !!message.data?.chartData,
      });

      // Validate data structure
      if (!message.data) {
        Logger.error('[Dashboard] ERROR: analysisUpdate message has no data property');
        errorHandler.showError('Received invalid data from extension');
        return;
      }

      if (!message.data.dependencies || !Array.isArray(message.data.dependencies)) {
        Logger.error('[Dashboard] ERROR: dependencies is missing or not an array', message.data);
        errorHandler.showError('Received invalid dependencies data');
        return;
      }

      // Hide error container when new data arrives
      errorHandler.hideError();

      // Update offline banner if networkStatus included, otherwise clear stale state
      const networkStatus = message.data.networkStatus;
      const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const hasNetworkIssues =
        isBrowserOffline ||
        (!!networkStatus &&
          (networkStatus.isOnline === false ||
            (Array.isArray(networkStatus.degradedFeatures) &&
              networkStatus.degradedFeatures.length > 0)));

      // If a new analysis arrives without network issues, drop any sticky offline banner
      if (!hasNetworkIssues) {
        window.offlineSticky = false;
        window.offlineMessage = '';
      }

      if (networkStatus) {
        updateOfflineNotification(networkStatus);
      } else if (window.offlineSticky) {
        updateOfflineNotification({
          isOnline: false,
          degradedFeatures: [],
          message: window.offlineMessage,
        });
      } else {
        updateOfflineNotification(null);
      }

      // Store data globally for export
      window.transitiveEnabled =
        typeof message.data.transitiveEnabled === 'boolean' ? message.data.transitiveEnabled : true;
      window.currentDashboardData = message.data;

      Logger.log(
        '[Dashboard] Calling renderDashboard with',
        message.data.dependencies.length,
        'dependencies'
      );
      renderDashboard(message.data);
      Logger.log('[Dashboard] renderDashboard completed');
      break;
    }
    case 'offlineStatus': {
      const offlineMessage =
        (message.data && message.data.message) ||
        'Limited connectivity detected. Some features require internet.';
      const mode = message.data && message.data.mode;

      // Persist banner until user closes or we explicitly clear
      window.offlineSticky = true;
      window.offlineMessage = offlineMessage;

      updateOfflineNotification({
        isOnline: false,
        degradedFeatures: [],
        message: offlineMessage,
      });

      if (mode === 'partial') {
        showLoadingOverlay(offlineMessage, null);
      }
      break;
    }
    case 'loading':
      Logger.log('[Dashboard] Processing loading state:', message.data);
      showLoading(message.data.isLoading, message.data.options);
      break;
    case 'progressUpdate':
      Logger.log('[Dashboard] Processing progress update:', message.data);
      if (message.data && typeof message.data.progress === 'number') {
        const progressText = message.data.message || 'Refreshing analysis...';
        showLoadingOverlay(progressText, message.data.progress);
      }
      break;
    case 'error':
      Logger.log('[Dashboard] Processing error:', message.data);
      // Show error but maintain last known good state
      showError(message.data.message || message.data.error);
      break;
    case 'alternativesLoading':
      handleAlternativesLoading(message.data);
      break;
    case 'alternativesResult':
      handleAlternativesResult(message.data);
      break;
    case 'alternativesError':
      handleAlternativesError(message.data);
      break;
    case 'alternativesConfigRequired':
      handleAlternativesConfigRequired(message.data);
      break;
    case 'alternativesReset':
      resetAlternativesState();
      break;
    case 'alternativesConfigChanged':
      handleAlternativesConfigChanged(message.data);
      break;
    case 'cacheStatusChanged':
      Logger.log('[Webview] Handling cacheStatusChanged:', message.data.enabled);
      // Update cache toggle UI when extension changes cache setting
      if (message.data && typeof message.data.enabled === 'boolean') {
        cacheEnabled = message.data.enabled;
        updateCacheToggleUI(cacheEnabled);
        Logger.log('[Dashboard] Cache status updated:', cacheEnabled ? 'ENABLED' : 'DISABLED');
        if (!cacheEnabled) {
          resetAlternativesState();
        }
      }
      break;
    case 'unusedPackagesPreview':
    case 'unusedPackagesResult':
      if (typeof window.updateCleanupWidget === 'function') {
        window.updateCleanupWidget(message);
      }
      break;
    default:
      Logger.warn('[Dashboard] Unknown message type:', message.type);
  }
};

// Add message listener and store reference
window.addEventListener('message', messageListener);
eventListeners.message = messageListener;

// Visibility helper to handle both class-based and attribute-based hiding
function setVisibility(el, visible) {
  if (!el) return;
  if (visible) {
    el.classList.remove('hidden');
    el.removeAttribute('hidden');
  } else {
    el.classList.add('hidden');
    el.setAttribute('hidden', 'true');
  }
}

function logLlmEvent(stage, data) {
  const provider = (data && data.provider) || 'unknown';
  const packageName = (data && data.packageName) || 'unknown';
  const payload = {
    stage,
    provider,
    packageName,
    timestamp: new Date().toISOString(),
  };

  if (stage === 'result' && data && Array.isArray(data.suggestions)) {
    payload.suggestionCount = data.suggestions.length;
  }

  if (stage === 'error' && data && data.message) {
    payload.error = data.message;
  }

  console.log('[DepPulse][LLM]', payload);
}

function handleAlternativesLoading(data) {
  const packageName = data?.packageName;
  if (!packageName) return;

  logLlmEvent('request', data);

  alternativeTabState[packageName] = 'loading';
  const container = getAlternativesContainer(packageName);
  if (!container) return;

  container.innerHTML = `
    <div class="flex items-center gap-3 text-gray-600 dark:text-gray-300">
      <span class="animate-spin">⏳</span>
      <span>Fetching AI-generated suggestions...</span>
    </div>
  `;
}

function handleAlternativesResult(data) {
  const packageName = data?.packageName;
  if (!packageName) return;

  const suggestions = data?.suggestions || [];
  const provider = data?.provider;

  logLlmEvent('result', { ...data, suggestions });

  alternativeTabState[packageName] = 'loaded';
  alternativeSuggestionData[packageName] = { suggestions, provider };
  delete alternativeErrorState[packageName];

  const container = getAlternativesContainer(packageName);
  if (!container) return;

  if (suggestions.length === 0) {
    container.innerHTML = `
      <div class="flex items-start gap-3 text-gray-600 dark:text-gray-300">
        <span class="text-lg">🤔</span>
        <div>
          <p class="font-semibold text-gray-800 dark:text-gray-100">No close alternatives detected</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">Try exploring npm with related keywords.</p>
        </div>
      </div>
    `;
    return;
  }

  const disclaimer = renderAlternativesDisclaimer(provider);
  container.innerHTML =
    disclaimer + suggestions.map((suggestion) => renderAlternativeCard(suggestion)).join('');
}

function handleAlternativesError(data) {
  const packageName = data?.packageName;
  if (!packageName) return;

  logLlmEvent('error', data);

  const rawMessage = data?.message || 'Unable to fetch suggestions.';
  const provider = data?.provider;
  const missingKey = data?.missingKey === true;
  const missingModel = data?.missingModel === true;
  const lowerMessage = rawMessage.toLowerCase();
  const keyHint =
    lowerMessage.includes('api key') ||
    lowerMessage.includes('token') ||
    lowerMessage.includes('auth') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('credit') ||
    lowerMessage.includes('quota');
  const modelHint = lowerMessage.includes('model');

  // Detect network-related errors and show a friendlier message
  const isNetworkError =
    rawMessage.includes('No response from server') ||
    rawMessage.includes('offline') ||
    rawMessage.includes('network') ||
    rawMessage.includes('ENOTFOUND') ||
    rawMessage.includes('ETIMEDOUT') ||
    rawMessage.includes('ECONNREFUSED') ||
    rawMessage.includes('fetch failed');

  const isAuthError =
    rawMessage.toLowerCase().includes('auth') ||
    rawMessage.toLowerCase().includes('unauthorized') ||
    rawMessage.toLowerCase().includes('forbidden') ||
    rawMessage.toLowerCase().includes('api key') ||
    rawMessage.toLowerCase().includes('model') ||
    rawMessage.toLowerCase().includes('token') ||
    rawMessage.toLowerCase().includes('quota') ||
    rawMessage.toLowerCase().includes('credit');

  const message = isNetworkError
    ? 'You appear to be offline. Alternatives require an internet connection.'
    : rawMessage;

  alternativeTabState[packageName] = 'error';
  alternativeErrorState[packageName] = message;

  const container = getAlternativesContainer(packageName);
  if (!container) return;

  if (isAuthError) {
    const settingQuery =
      provider === 'openrouter'
        ? 'depPulse.api.openRouter'
        : provider === 'openai'
          ? 'depPulse.api.openai'
          : provider === 'gemini'
            ? 'depPulse.api.gemini'
            : 'depPulse.api';
    const modelSetting =
      provider === 'openrouter'
        ? 'depPulse.api.openRouterModel'
        : provider === 'openai'
          ? 'depPulse.api.openaiModel'
          : provider === 'gemini'
            ? 'depPulse.api.geminiModel'
            : 'depPulse.api';

    const showKeyButton = missingKey || (!missingModel && keyHint);
    const showModelButton = missingModel || (!missingKey && modelHint);
    const uncertain = !showKeyButton && !showModelButton;
    const safeProvider = escapeAttribute(provider ?? '');
    const safeModelSetting = escapeAttribute(modelSetting);
    const safeSettingQuery = escapeAttribute(settingQuery);

    const buttons = [];
    if (showKeyButton || uncertain) {
      buttons.push(
        `<button class="action-tab-btn text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="" data-provider="${safeProvider}" data-scope="key">Config Key</button>`
      );
    }
    if (showModelButton || uncertain) {
      buttons.push(
        `<button class="action-tab-btn primary text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="${safeModelSetting}" data-provider="${safeProvider}" data-scope="model">Config Model</button>`
      );
    }

    container.innerHTML = `
      <div class="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4">
        <div class="flex items-start gap-3">
          <div class="text-lg">🔑</div>
          <div class="space-y-1">
            <p class="font-semibold text-amber-900 dark:text-amber-100">LLM key or model issue</p>
            <p class="text-xs text-amber-800 dark:text-amber-200">${escapeAttribute(message)}</p>
            <div class="mt-2 flex gap-2 flex-nowrap overflow-x-auto">
              ${
                buttons.length > 0
                  ? buttons.join('')
                  : `<button class="action-tab-btn primary text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="${safeSettingQuery}" data-provider="${safeProvider}" data-scope="both">Open DepPulse settings</button>`
              }
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="flex items-start gap-3 text-red-600 dark:text-red-400">
      <span class="text-lg">${isNetworkError ? '📡' : '⚠️'}</span>
      <div>
        <p class="font-semibold">${isNetworkError ? 'No internet connection' : 'Failed to load alternatives'}</p>
        <p class="text-xs">${escapeAttribute(message)}</p>
      </div>
    </div>
  `;
}

function handleAlternativesConfigRequired(data) {
  const packageName = data?.packageName;
  if (!packageName) return;

  alternativeTabState[packageName] = 'config-required';
  const container = getAlternativesContainer(packageName);
  if (!container) return;

  container.innerHTML = `
    <div class="rounded-2xl border border-blue-200/60 dark:border-blue-800/60 bg-linear-to-br from-white via-blue-50 to-blue-100 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950 p-5 text-sm text-slate-900 dark:text-slate-100 shadow-sm">
      <div class="flex items-start gap-3">
        <div class="h-10 w-10 rounded-xl bg-blue-600 text-white flex items-center justify-center text-lg shadow-md">✨</div>
        <div class="space-y-1">
          <div class="text-base font-semibold">Unlock AI-powered alternatives</div>
          <p class="text-sm text-slate-600 dark:text-slate-300">Connect a provider with key and model to generate smarter suggestions.</p>
        </div>
      </div>

      <div class="mt-4 grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-3 shadow-xs flex flex-col h-full">
          <div class="font-semibold text-slate-900 dark:text-slate-100">OpenRouter</div>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Set both API key and model (e.g., gpt-4o-mini).</p>
          <div class="mt-auto flex gap-2 flex-nowrap overflow-x-auto">
            <button class="action-tab-btn text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="" data-provider="openrouter" data-scope="key">
              Config Key
            </button>
            <button class="action-tab-btn primary text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="depPulse.api.openRouterModel" data-provider="" data-scope="model">
              Config Model
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-3 shadow-xs flex flex-col h-full">
          <div class="font-semibold text-slate-900 dark:text-slate-100">OpenAI</div>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Set both API key and model (e.g., gpt-4o-mini).</p>
          <div class="mt-auto flex gap-2 flex-nowrap overflow-x-auto">
            <button class="action-tab-btn text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="" data-provider="openai" data-scope="key">
              Config Key
            </button>
            <button class="action-tab-btn primary text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="depPulse.api.openaiModel" data-provider="" data-scope="model">
              Config Model
            </button>
          </div>
        </div>

        <div class="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/70 p-3 shadow-xs flex flex-col h-full">
          <div class="font-semibold text-slate-900 dark:text-slate-100">Google Gemini</div>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">Set both API key and model (e.g., gemini-1.5-flash).</p>
          <div class="mt-auto flex gap-2 flex-nowrap overflow-x-auto">
            <button class="action-tab-btn text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="" data-provider="gemini" data-scope="key">
              Config Key
            </button>
            <button class="action-tab-btn primary text-xs px-3 py-1" type="button" data-action="open-settings" data-setting-key="depPulse.api.geminiModel" data-provider="" data-scope="model">
              Config Model
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getAlternativesContainer(packageName) {
  if (!packageName) return null;
  const selector = `.alternatives-panel[data-package="${cssEscapeValue(packageName)}"] .alternatives-container`;
  return document.querySelector(selector);
}

function renderAlternativeCard(suggestion) {
  return `
    <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-semibold text-gray-900 dark:text-gray-100">${escapeAttribute(suggestion.name)}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${suggestion.description ? escapeAttribute(suggestion.description) : 'No description provided.'}
          </p>
        </div>
        <div class="text-right">
          <p class="text-sm font-semibold text-blue-600 dark:text-blue-300">${formatDownloads(suggestion.weeklyDownloads)}</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">weekly downloads</p>
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="action-tab-btn primary"
                type="button"
                data-action="copy-install"
                data-value="${escapeAttribute(suggestion.installCommand)}"
                data-announce="Install command copied to clipboard">
          Copy install: ${escapeAttribute(suggestion.installCommand.split(' ')[0])}
        </button>
        <button class="action-tab-btn"
                type="button"
                data-action="open-link"
                data-url="${escapeAttribute(suggestion.npmUrl)}"
                data-announce="Opening npm page for ${escapeAttribute(suggestion.name)}">
          View on npm
        </button>
      </div>
    </div>
  `;
}

function renderAlternativesDisclaimer(provider) {
  const label =
    provider === 'openrouter'
      ? 'OpenRouter'
      : provider === 'openai'
        ? 'OpenAI'
        : provider === 'gemini'
          ? 'Google Gemini'
          : 'an AI model';

  return `
    <div class="mb-3 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/40 px-3 py-2 text-xs text-blue-900 dark:text-blue-100">
      Suggestions are generated by ${label}. Verify before adopting—they may be incomplete or outdated.
    </div>
  `;
}

function formatDownloads(count) {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

window.copyInstallCommand = function copyInstallCommand(command) {
  if (!command) return;
  copyTextToClipboard(command, 'Install command copied to clipboard');
};

window.openExternalLink = function openExternalLink(url, announce) {
  if (!url) return;
  vscode.postMessage({
    command: 'openExternalLink',
    data: { url, announce },
  });
};

window.resetLlmConfig = function resetLlmConfig() {
  vscode.postMessage({
    command: 'depPulse.resetLlmConfig',
  });
};

window.openDepPulseSettings = function openDepPulseSettings(settingKey, provider, scope) {
  vscode.postMessage({
    command: 'openSettings',
    data: { query: settingKey || 'depPulse.api', provider, scope },
  });
};

function resetAlternativesState() {
  Object.keys(alternativeTabState).forEach((key) => {
    delete alternativeTabState[key];
  });
  Object.keys(alternativeSuggestionData).forEach((key) => {
    delete alternativeSuggestionData[key];
  });
  Object.keys(alternativeErrorState).forEach((key) => {
    delete alternativeErrorState[key];
  });

  document.querySelectorAll('.alternatives-container').forEach((container) => {
    container.innerHTML = `
      <div class="flex items-start gap-3 text-gray-600 dark:text-gray-400">
        <span class="text-xl" aria-hidden="true">💡</span>
        <div>
          <p class="font-semibold text-gray-800 dark:text-gray-100">Fetch alternative packages</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">Cache is off. We’ll fetch fresh AI suggestions when you open this tab.</p>
        </div>
      </div>
    `;
  });
}

function handleAlternativesConfigChanged(status) {
  // Clear cached UI state
  resetAlternativesState();

  // If a tab is currently active, trigger a refresh or show immediate error
  const expandedRow = findExpandedRow();
  if (!expandedRow) return;

  const activeTab = expandedRow.querySelector('.expanded-tab.active');
  if (!activeTab || activeTab.dataset.tab !== 'alternatives') {
    return;
  }

  const packageName = expandedRow.dataset.packageName;
  if (!packageName) return;

  if (status?.status === 'missing') {
    handleAlternativesError({
      packageName,
      message: status.message,
      provider: status.provider,
    });
    return;
  }

  if (status?.status === 'unconfigured') {
    handleAlternativesConfigRequired({ packageName });
    return;
  }

  if (status?.status === 'invalid') {
    handleAlternativesError({
      packageName,
      message: status.message || 'LLM configuration is invalid. Please check your settings.',
      provider: status.provider,
    });
    return;
  }

  // Otherwise, attempt to fetch with new config
  requestAlternativesForPackage(packageName);
}

function renderDashboard(data) {
  Logger.log('[Dashboard] renderDashboard called with data:', {
    hasData: !!data,
    dependenciesCount: data?.dependencies?.length,
    hasMetrics: !!data?.metrics,
    hasHealthScore: !!data?.healthScore,
  });

  // Clear refresh timeout if it exists
  if (window.refreshTimeout) {
    clearTimeout(window.refreshTimeout);
    window.refreshTimeout = null;
  }

  // Hide all loading states
  hideLoadingOverlay();
  hideChartSkeleton();
  hideEmptyStates();

  // Re-enable refresh button
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove('opacity-50', 'cursor-not-allowed');

    const refreshIcon = document.getElementById('refresh-icon');
    if (refreshIcon) {
      refreshIcon.classList.remove('spinning');
    }
    Logger.log('[Dashboard] Refresh button re-enabled');
  }

  // Store package count for dynamic timeout calculation on next scan
  if (data.metrics && data.metrics.totalDependencies) {
    window.lastScanPackageCount = data.metrics.totalDependencies;
    Logger.log(
      `[Dashboard] Stored package count for next scan: ${window.lastScanPackageCount} packages`
    );
  }

  // Check for empty states
  if (!data || !data.dependencies || data.dependencies.length === 0) {
    Logger.log('[Dashboard] No dependencies found, showing empty state');
    showEmptyStateNoDeps();
    return;
  }

  Logger.log('[Dashboard] Rendering dashboard with', data.dependencies.length, 'dependencies');

  // Check if all dependencies are healthy
  if (data.metrics.criticalIssues === 0 && data.metrics.outdatedPackages === 0) {
    showEmptyStateHealthy();
    // Still show the data but with success message
  }

  // Show dashboard content
  showDashboardContent();

  // Update package manager badge
  updatePackageManagerBadge(data.packageManager);

  // Update last scanned timestamp
  updateLastScanned(data.lastScanned);

  // Update cache indicator
  updateCacheIndicator(data.isCached, data.cacheAge);

  // Update cache toggle switch state if provided
  if (typeof data.cacheEnabled !== 'undefined') {
    // Update UI using helper
    updateCacheToggleUI(data.cacheEnabled);
  }

  // Update performance metrics if available
  if (data.performanceMetrics) {
    updatePerformanceMetrics(data.performanceMetrics);
  }

  // Update health score and metrics
  updateHealthScore(data.healthScore);
  updateMetrics(data.metrics);

  // Show invalid packages notification if any exist
  updateInvalidPackagesNotification(data.failedPackages);

  // Show offline/limited connectivity notification if network issues detected
  updateOfflineNotification(data.networkStatus);

  // Track project layout for UI adjustments (monolith vs monorepo)
  window.packageJsonCount =
    typeof data.packageJsonCount === 'number' ? data.packageJsonCount : undefined;
  window.isSinglePackageProject = Boolean(
    data.isSinglePackageMonolith || (data.packageJsonCount === 1 && data.isMonorepo === false)
  );
  Logger.log('[Dashboard] Project layout', {
    isMonorepo: data.isMonorepo,
    packageJsonCount: data.packageJsonCount,
    isSinglePackageProject: window.isSinglePackageProject,
  });

  // Render charts
  // Initialize lazy loading for charts (if not already done)
  if (typeof initializeLazyChartLoading === 'function') {
    initializeLazyChartLoading();
  }

  // Render charts (will use lazy loading if elements not visible)
  renderSeverityChart(data.chartData.severity);
  renderFreshnessChart(data.chartData.freshness);
  renderCVSSChart(data.dependencies);

  // Set data for both managers
  Logger.log('[Dashboard] Setting table data with', data.dependencies?.length, 'dependencies');
  Logger.log('[Dashboard] Dependencies is array?', Array.isArray(data.dependencies));
  Logger.log('[Dashboard] First few deps:', data.dependencies?.slice(0, 3));
  tableManager.setData(data.dependencies);
  cardManager.setData(data.dependencies);

  // Store data for filtering
  window.currentDashboardData = data;
  Object.keys(alternativeTabState).forEach((key) => {
    delete alternativeTabState[key];
  });
  Object.keys(alternativeSuggestionData).forEach((key) => {
    delete alternativeSuggestionData[key];
  });
  Object.keys(alternativeErrorState).forEach((key) => {
    delete alternativeErrorState[key];
  });

  // Render current view
  renderCurrentView();

  // Announce dashboard loaded to screen readers
  const criticalCount = data.metrics.criticalIssues;
  const totalCount = data.metrics.totalDependencies;
  let announcement = `Dashboard loaded. ${totalCount} ${totalCount === 1 ? 'dependency' : 'dependencies'} found.`;

  if (criticalCount > 0) {
    announcement += ` ${criticalCount} critical ${criticalCount === 1 ? 'issue' : 'issues'} detected.`;
  } else {
    announcement += ' No critical issues.';
  }

  announceToScreenReader(announcement);
}

/**
 * Show loading overlay with optional text and progress
 * @param {string} text - Loading text to display (optional)
 * @param {number} progress - Progress percentage 0-100 (optional)
 */
function showLoadingOverlay(text = 'Analyzing Dependencies...', progress = null) {
  const overlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  const progressContainer = document.getElementById('loading-progress');
  const progressBar = document.getElementById('loading-progress-bar');
  const progressText = document.getElementById('loading-progress-text');

  setVisibility(overlay, true);

  if (loadingText && text) {
    loadingText.textContent = text;
    // Announce loading state
    announceToScreenReader(text);
  }

  if (progress !== null && progressContainer && progressBar && progressText) {
    progressContainer.classList.remove('hidden');
    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${Math.round(progress)}%`;
  } else if (progressContainer) {
    progressContainer.classList.add('hidden');
  }
}

/**
 * Hide loading overlay
 */
function hideLoadingOverlay() {
  const overlay = document.getElementById('loading-overlay');
  setVisibility(overlay, false);
}

/**
 * Show table skeleton loader
 */

// Chart skeleton functions removed - not used, we have full-screen loading overlay instead
function hideChartSkeleton() {
  // No-op: skeleton removed, using loading overlay instead
}

function getScoreIndicator(score) {
  if (score >= 90) {
    return {
      label: 'Excellent',
      labelClass: 'text-xs font-medium text-green-600 dark:text-green-400 mt-1',
      color: '#16a34a',
    };
  }

  if (score >= 70) {
    return {
      label: 'Good',
      labelClass: 'text-xs font-medium text-yellow-600 dark:text-yellow-400 mt-1',
      color: '#eab308',
    };
  }

  if (score >= 50) {
    return {
      label: 'Elevated',
      labelClass: 'text-xs font-medium text-orange-600 dark:text-orange-400 mt-1',
      color: '#f97316',
    };
  }

  if (score >= 30) {
    return {
      label: 'High Risk',
      labelClass: 'text-xs font-medium text-amber-600 dark:text-amber-400 mt-1',
      color: '#d97706',
    };
  }

  return {
    label: 'Critical',
    labelClass: 'text-xs font-medium text-red-600 dark:text-red-400 mt-1',
    color: '#dc2626',
  };
}

/**
 * Show loading state (wrapper function for backward compatibility)
 * @param {boolean} isLoading - Whether to show loading state
 * @param {Object} options - Loading options (text, progress, showSkeleton)
 */
function showLoading(isLoading, options = {}) {
  if (isLoading) {
    const { text, progress, showSkeleton = false } = options;

    if (showSkeleton) {
      // Skeleton mode not used - fallback to overlay
      showLoadingOverlay(text, progress);
    } else {
      showLoadingOverlay(text, progress);
    }
  } else {
    hideLoadingOverlay();
    hideChartSkeleton();

    // Clear refresh timeout to prevent delayed error message
    if (window.refreshTimeout) {
      clearTimeout(window.refreshTimeout);
      window.refreshTimeout = null;
    }

    // Re-enable refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('opacity-50', 'cursor-not-allowed');

      const refreshIcon = document.getElementById('refresh-icon');
      if (refreshIcon) {
        refreshIcon.classList.remove('spinning');
      }
    }
  }
}

/**
 * Update health score display with detailed breakdown and circular progress
 * @param {Object} healthScore - Health score object with components
 */
function updateHealthScore(healthScore) {
  const score = healthScore.overall;
  const valueEl = document.getElementById('health-score-value');
  const labelEl = document.getElementById('health-score-label');
  const indicator = getScoreIndicator(score);

  if (valueEl) {
    // Remove shimmer loading animation
    valueEl.classList.remove('shimmer-text');
    // Animate number
    animateNumber(valueEl, parseInt(valueEl.textContent, 10) || 0, score, 1000);
    valueEl.style.color = indicator.color;

    // Update label
    if (labelEl) {
      labelEl.textContent = indicator.label;
      labelEl.className = indicator.labelClass;
    }
  }

  // Animate circular progress ring
  animateHealthScoreCircle(score, indicator.color);

  // Update component breakdown
  updateHealthScoreBreakdown(healthScore);
}

/**
 * Update health score component breakdown
 * @param {Object} healthScore - Health score object with components
 */
function updateHealthScoreBreakdown(healthScore) {
  const breakdownEl = document.getElementById('health-score-breakdown');
  if (!breakdownEl) return;

  // Show breakdown panel
  breakdownEl.classList.remove('hidden');

  // Get dashboard data for tooltip calculations
  const dashboardData = window.currentDashboardData || {};
  const chartData = dashboardData.chartData || {};
  const metrics = dashboardData.metrics || {};
  const dependencies = dashboardData.dependencies || [];
  // Use dependencies.length (real packages) or analyzedDependencies instead of totalDependencies
  // to match what's actually being counted in the tooltip calculations
  const totalDeps =
    dependencies.length || metrics.analyzedDependencies || metrics.totalDependencies || 1;

  // Calculate breakdown data for tooltips
  const securityData = chartData.severity || {};
  const freshnessData = chartData.freshness || {};

  // Count compatibility issues
  let deprecatedCount = 0;
  let breakingChangesCount = 0;
  dependencies.forEach((dep) => {
    if (dep.compatibility) {
      if (dep.compatibility.status === 'version-deprecated') deprecatedCount++;
      if (dep.compatibility.status === 'breaking-changes') breakingChangesCount++;
    }
  });

  // Count license issues and categorize licenses
  let licenseIssues = 0;
  const licenseStats = {
    permissive: 0,
    copyleft: 0,
    proprietary: 0,
    unknown: 0,
    incompatible: 0,
  };
  dependencies.forEach((dep) => {
    if (dep.license) {
      if (!dep.license.isCompatible) {
        licenseIssues++;
        licenseStats.incompatible++;
      }
      // Count by type
      if (dep.license.licenseType === 'permissive') licenseStats.permissive++;
      else if (dep.license.licenseType === 'copyleft') licenseStats.copyleft++;
      else if (dep.license.licenseType === 'proprietary') licenseStats.proprietary++;
      else licenseStats.unknown++;
    }
  });

  // Update each component score
  const components = [
    {
      key: 'security',
      color: 'bg-red-500',
      valueEl: 'health-score-security-value',
      barEl: 'health-score-security-bar',
      tooltipEl: 'health-score-security-tooltip',
      getTooltipText: (_score) => {
        const critical = securityData.critical || 0;
        const high = securityData.high || 0;
        const total = critical + high;
        if (total === 0) {
          return `No vulnerabilities found. All ${totalDeps} dependencies are secure.`;
        }
        return `${total} vulnerable package${total > 1 ? 's' : ''} (${critical} critical, ${high} high). Score based on CVSS severity.`;
      },
    },
    {
      key: 'freshness',
      color: 'bg-yellow-500',
      valueEl: 'health-score-freshness-value',
      barEl: 'health-score-freshness-bar',
      tooltipEl: 'health-score-freshness-tooltip',
      getTooltipText: (_score) => {
        const unmaintained = freshnessData.unmaintained || 0;
        const major = freshnessData.major || 0;
        const minor = freshnessData.minor || 0;
        const patch = freshnessData.patch || 0;
        const outdated = major + minor + patch;
        if (outdated === 0 && unmaintained === 0) {
          return `All ${totalDeps} dependencies are up to date.`;
        }
        const parts = [];
        if (unmaintained > 0) parts.push(`${unmaintained} unmaintained`);
        if (major > 0) parts.push(`${major} major update${major > 1 ? 's' : ''}`);
        if (minor > 0) parts.push(`${minor} minor update${minor > 1 ? 's' : ''}`);
        if (patch > 0) parts.push(`${patch} patch update${patch > 1 ? 's' : ''}`);
        return `${parts.join(', ')} available. Score reflects update availability.`;
      },
    },
    {
      key: 'compatibility',
      color: 'bg-orange-500',
      valueEl: 'health-score-compatibility-value',
      barEl: 'health-score-compatibility-bar',
      tooltipEl: 'health-score-compatibility-tooltip',
      getTooltipText: (_score) => {
        if (deprecatedCount === 0 && breakingChangesCount === 0) {
          return `All ${totalDeps} dependencies are compatible. No breaking changes detected.`;
        }
        const parts = [];
        if (deprecatedCount > 0) parts.push(`${deprecatedCount} deprecated`);
        if (breakingChangesCount > 0)
          parts.push(
            `${breakingChangesCount} breaking change${breakingChangesCount > 1 ? 's' : ''}`
          );
        return `${parts.join(', ')} detected. Upgrade may require code changes.`;
      },
    },
    {
      key: 'license',
      color: 'bg-green-500',
      valueEl: 'health-score-license-value',
      barEl: 'health-score-license-bar',
      tooltipEl: 'health-score-license-tooltip',
      getTooltipText: (_score) => {
        if (licenseIssues === 0) {
          return `All ${totalDeps} dependencies have compatible licenses. ${licenseStats.permissive > 0 ? `${licenseStats.permissive} permissive, ` : ''}${licenseStats.copyleft > 0 ? `${licenseStats.copyleft} copyleft.` : ''}`;
        }
        const parts = [];
        if (licenseStats.incompatible > 0) {
          parts.push(`${licenseStats.incompatible} incompatible`);
        }
        if (licenseStats.copyleft > 0) {
          parts.push(`${licenseStats.copyleft} copyleft (may require open-sourcing)`);
        }
        if (licenseStats.proprietary > 0) {
          parts.push(`${licenseStats.proprietary} proprietary (commercial restrictions)`);
        }
        if (licenseStats.unknown > 0) {
          parts.push(`${licenseStats.unknown} unknown (needs review)`);
        }
        return `${parts.join(', ')}. Review license compatibility to avoid legal issues.`;
      },
    },
  ];

  components.forEach(
    ({ key, valueEl: valueId, barEl: barId, tooltipEl: tooltipId, getTooltipText }) => {
      const value = healthScore[key] ?? 100;
      const indicator = getScoreIndicator(value);
      const valueElement = document.getElementById(valueId);
      const barElement = document.getElementById(barId);
      const tooltipElement = document.getElementById(tooltipId);

      if (valueElement) {
        valueElement.textContent = `${Math.round(value)}%`;
        valueElement.style.color = indicator.color;
      }

      if (barElement) {
        barElement.style.width = `${Math.round(value)}%`;
        barElement.style.backgroundColor = indicator.color;
      }

      if (tooltipElement && getTooltipText) {
        tooltipElement.textContent = getTooltipText(value);
      }
    }
  );
}

/**
 * Animate circular progress ring
 * @param {number} percentage - Progress percentage (0-100)
 * @param {string} [strokeColor] - Optional stroke color
 */
function animateHealthScoreCircle(percentage, strokeColor) {
  const circle = document.getElementById('health-score-circle');
  if (!circle) return;

  const circumference = 2 * Math.PI * 70; // radius = 70
  const offset = circumference - (percentage / 100) * circumference;

  if (strokeColor) {
    circle.style.stroke = strokeColor;
  }

  // Animate
  circle.style.strokeDashoffset = offset;
}

/**
 * Animate number transition
 * @param {HTMLElement} element - Element to animate
 * @param {number} start - Start value
 * @param {number} end - End value
 * @param {number} duration - Animation duration in ms
 */
function animateNumber(element, start, end, duration) {
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function (ease-out)
    const easeOut = 1 - (1 - progress) ** 3;
    const current = Math.round(start + (end - start) * easeOut);

    element.textContent = current;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

/**
 * Update metric cards with sparklines
 * @param {Object} metrics - Dashboard metrics
 */
function initializeStickyHeader() {
  const header = document.getElementById('main-header');
  if (!header) return;

  let lastScrollY = window.scrollY;
  let ticking = false;

  // Store scroll listener reference
  const scrollListener = () => {
    lastScrollY = window.scrollY;
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (lastScrollY > 100) {
          header.classList.add('compact');
        } else {
          header.classList.remove('compact');
        }
        ticking = false;
      });
      ticking = true;
    }
  };

  // Add scroll listener and store reference
  window.addEventListener('scroll', scrollListener);
  eventListeners.scroll = scrollListener;
}

/**
 * Switch tabs in expanded row view
 * @param {Event} event - Click event
 * @param {string} rowKey - Row identifier (package + workspace)
 * @param {string} tabName - Tab to switch to
 * @param {string} packageName - Original package name
 */
window.switchExpandedTab = function switchExpandedTab(event, rowKey, tabName, packageName) {
  if (event && typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }

  // Find the expanded row
  const expandedRow = findExpandedRow(rowKey, packageName);
  if (!expandedRow) return;

  // Update tab buttons
  const tabs = expandedRow.querySelectorAll('.expanded-tab');
  tabs.forEach((tab) => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add(
        'active',
        'text-blue-600',
        'dark:text-blue-400',
        'border-b-2',
        'border-blue-600',
        'dark:border-blue-400'
      );
      tab.classList.remove('text-gray-600', 'dark:text-gray-400');
    } else {
      tab.classList.remove(
        'active',
        'text-blue-600',
        'dark:text-blue-400',
        'border-b-2',
        'border-blue-600',
        'dark:border-blue-400'
      );
      tab.classList.add('text-gray-600', 'dark:text-gray-400');
    }
  });

  // Update tab content
  const contents = expandedRow.querySelectorAll('.tab-content');
  contents.forEach((content) => {
    if (content.dataset.tabContent === tabName) {
      content.classList.remove('hidden');
      content.classList.add('active', 'animate-fade-in');
    } else {
      content.classList.add('hidden');
      content.classList.remove('active');
    }
  });

  // Scroll the active tab into view within its scroll container
  const activeTab = expandedRow.querySelector(`.expanded-tab[data-tab="${tabName}"]`);
  if (activeTab) {
    // Find the tab header container (has overflow-x-auto)
    const tabHeaderContainer = activeTab.closest('.overflow-x-auto');
    if (tabHeaderContainer) {
      // Scroll the active tab into view, aligning to the start (left) so it's visible
      activeTab.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'start',
      });
    }
  }

  // Also ensure the expanded row is visible in the table container
  // Find the table container by looking for the table-scroll-region or traversing up from the row
  let tableContainer = document.getElementById('table-scroll-region');
  if (!tableContainer) {
    // Traverse up from the expanded row to find a scrollable container that's not the tab header
    let parent = expandedRow.parentElement;
    while (parent && parent !== document.body) {
      const computedStyle = window.getComputedStyle(parent);
      if (
        computedStyle.overflowX === 'auto' ||
        computedStyle.overflowX === 'scroll' ||
        computedStyle.overflow === 'auto' ||
        computedStyle.overflow === 'scroll'
      ) {
        // Make sure it's not the tab header container
        if (
          !parent.classList.contains('overflow-x-auto') ||
          !parent.querySelector('.expanded-tab')
        ) {
          tableContainer = parent;
          break;
        }
      }
      parent = parent.parentElement;
    }
    // Fallback to finding any overflow-x-auto container
    if (!tableContainer) {
      const containers = document.querySelectorAll('.overflow-x-auto');
      // Find the one that contains the table body, not the tab headers
      for (const container of containers) {
        if (container.querySelector('#dependency-table-body') || container.querySelector('table')) {
          tableContainer = container;
          break;
        }
      }
    }
  }

  if (tableContainer && expandedRow) {
    // Check if the expanded row is visible in the viewport
    const containerRect = tableContainer.getBoundingClientRect();
    const rowRect = expandedRow.getBoundingClientRect();

    // If the row is not fully visible horizontally, scroll it into view
    if (rowRect.left < containerRect.left || rowRect.right > containerRect.right) {
      expandedRow.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'start',
      });
    }
  }

  if (tabName === 'alternatives') {
    const altKey = packageName || rowKey;
    if (alternativeSuggestionData[altKey]) {
      const stored = alternativeSuggestionData[altKey];
      const payload = Array.isArray(stored) ? { suggestions: stored, provider: undefined } : stored;
      handleAlternativesResult({
        packageName: altKey,
        ...payload,
      });
    } else if (alternativeErrorState[altKey]) {
      handleAlternativesError({
        packageName: altKey,
        message: alternativeErrorState[altKey],
      });
    } else {
      requestAlternativesForPackage(packageName);
    }
  }
};

function requestAlternativesForPackage(packageName) {
  if (!packageName) return;

  if (
    alternativeTabState[packageName] === 'loading' ||
    alternativeTabState[packageName] === 'loaded'
  ) {
    return;
  }

  alternativeTabState[packageName] = 'loading';
  handleAlternativesLoading({ packageName });
  vscode.postMessage({ command: 'showAlternatives', data: { name: packageName } });
}

function findExpandedRow(rowKey, packageName) {
  if (rowKey) {
    const selector = `.expanded-row[data-row-key="${cssEscapeValue(rowKey)}"]`;
    const match = document.querySelector(selector);
    if (match) return match;
  }
  if (packageName) {
    const selector = `.expanded-row[data-package-name="${cssEscapeValue(packageName)}"]`;
    const match = document.querySelector(selector);
    if (match) return match;
  }
  return document.querySelector('.expanded-row');
}

function cssEscapeValue(value) {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/"/g, '\\"');
}
function updateInvalidPackagesNotification(failedPackages) {
  const notification = document.getElementById('invalid-packages-notification');
  const countEl = document.getElementById('invalid-package-count');
  const listEl = document.getElementById('invalid-packages-list');
  const closeBtn = document.getElementById('close-invalid-notification');

  if (!notification || !failedPackages || failedPackages.length === 0) {
    if (notification) {
      notification.classList.add('hidden');
    }
    return;
  }

  // Show notification
  notification.classList.remove('hidden');

  // Update count
  if (countEl) {
    countEl.textContent = failedPackages.length;
  }

  // Populate list
  if (listEl) {
    listEl.innerHTML = failedPackages
      .map(
        (pkg) =>
          `<li class="flex items-start gap-2">
        <span class="text-orange-500">•</span>
        <span>
          <strong>${sanitizeText(pkg.name)}</strong>@${sanitizeText(pkg.version)}
          <span class="text-orange-500 ml-1">(${sanitizeText(pkg.error)})</span>
        </span>
      </li>`
      )
      .join('');
  }

  // Close button handler
  if (closeBtn) {
    closeBtn.onclick = () => {
      notification.classList.add('hidden');
    };
  }
}

/**
 * Update offline/limited connectivity notification
 * Shows a banner when network issues are detected during analysis
 * @param {Object} networkStatus - Network status object from analysis
 */
function updateOfflineNotification(networkStatus) {
  const notification = document.getElementById('offline-notification');
  const messageEl = document.getElementById('offline-message');
  const closeBtn = document.getElementById('close-offline-notification');

  if (!notification) {
    return;
  }

  const isBrowserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const hasNetworkIssues =
    isBrowserOffline ||
    (!!networkStatus &&
      (networkStatus.isOnline === false ||
        (Array.isArray(networkStatus.degradedFeatures) &&
          networkStatus.degradedFeatures.length > 0)));

  // Clear any sticky offline state once we know the network is healthy
  if (!hasNetworkIssues && window.offlineSticky) {
    window.offlineSticky = false;
    window.offlineMessage = '';
  }

  // Determine if we should show based on sticky state or incoming status
  const shouldShow = window.offlineSticky || hasNetworkIssues;

  if (!shouldShow) {
    setVisibility(notification, false);
    return;
  }

  // Show notification
  setVisibility(notification, true);

  // Update message if provided
  const bannerMessage =
    (networkStatus && networkStatus.message) || window.offlineMessage || 'Limited connectivity';
  if (messageEl) {
    messageEl.textContent = bannerMessage;
  }

  // Close button handler
  if (closeBtn) {
    closeBtn.onclick = () => {
      window.offlineSticky = false;
      window.offlineMessage = '';
      setVisibility(notification, false);
    };
  }

  // Announce to screen readers
  if (typeof announceToScreenReader === 'function') {
    announceToScreenReader('Limited connectivity detected. Some features may be unavailable.');
  }
}

/**
 * Update package manager badge
 * @param {string} packageManager - Package manager (npm, pnpm, yarn)
 */
function updatePackageManagerBadge(packageManager) {
  const badge = document.getElementById('package-manager-badge');
  if (badge) {
    badge.textContent = packageManager;
  }
}

/**
 * Update last scanned timestamp
 * @param {string} timestamp - ISO timestamp
 */
function updateLastScanned(timestamp) {
  window.lastScannedDate = new Date(timestamp);
  updateTimestampDisplay();

  // Clear existing interval before setting new one
  if (window.timestampUpdateInterval) {
    clearInterval(window.timestampUpdateInterval);
    window.timestampUpdateInterval = null;
  }

  // Update every minute
  window.timestampUpdateInterval = setInterval(updateTimestampDisplay, 60000);
}

/**
 * Update the timestamp display
 */
function updateTimestampDisplay() {
  const element = document.getElementById('last-scanned');
  if (element && window.lastScannedDate) {
    const relativeTime = getTimeAgo(window.lastScannedDate);
    const fullTime = window.lastScannedDate.toLocaleString();
    element.textContent = `Last scanned: ${relativeTime}`;
    element.title = fullTime;
  }
}

/**
 * Update cache indicator
 * @param {boolean} isCached - Whether data is cached
 * @param {number} cacheAge - Cache age in minutes
 */
/**
 * Update performance metrics display
 * @param {Object} metrics - Performance metrics object
 */
function updatePerformanceMetrics(metrics) {
  if (!metrics) return;

  const scanDurationEl = document.getElementById('performance-scan-duration');
  const memoryEl = document.getElementById('performance-memory');
  const dependencyCountEl = document.getElementById('performance-dependency-count');

  if (scanDurationEl) {
    const seconds = (metrics.scanDuration / 1000).toFixed(2);
    scanDurationEl.textContent = `${seconds}s`;
  }

  if (memoryEl && metrics.memoryUsage) {
    const mb = (metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2);
    memoryEl.textContent = `${mb} MB`;
  }

  if (dependencyCountEl) {
    if (
      metrics.validDependencyCount !== undefined &&
      metrics.invalidDependencyCount !== undefined
    ) {
      let subtext = `${metrics.validDependencyCount} valid, ${metrics.invalidDependencyCount} invalid`;
      if (window.transitiveEnabled && metrics.transitiveDependencyCount !== undefined) {
        subtext += `, ${metrics.transitiveDependencyCount} transitive`;
      }

      dependencyCountEl.innerHTML = `
        <div class="flex flex-col">
          <div class="flex items-center gap-1">
            <span>${metrics.dependencyCount} Total</span>
            ${
              window.transitiveEnabled
                ? '<span class="text-xs font-normal text-gray-500 dark:text-gray-400">(excluded transitive deps)</span>'
                : ''
            }
          </div>
          <span class="text-xs font-normal text-gray-500 dark:text-gray-400">
            ${subtext}
          </span>
        </div>
      `;
    } else {
      dependencyCountEl.textContent = metrics.dependencyCount || '--';
    }
  }
}

/**
 * Toggle performance metrics panel visibility
 */
function togglePerformanceMetrics() {
  const panel = document.getElementById('performance-metrics-panel');
  const button = document.getElementById('toggle-performance-metrics');
  const switchEl = document.getElementById('metrics-toggle-switch');
  const knobEl = document.getElementById('metrics-toggle-knob');
  const textEl = document.getElementById('metrics-toggle-text');

  if (panel && button) {
    const isHidden = panel.classList.contains('hidden');

    if (isHidden) {
      // Show metrics
      panel.classList.remove('hidden');
      if (textEl) textEl.textContent = 'Hide Metrics';

      // Update switch state
      if (switchEl) {
        switchEl.classList.remove(
          'bg-gray-200',
          'dark:bg-gray-700',
          'group-hover:bg-gray-300',
          'dark:group-hover:bg-gray-600'
        );
        switchEl.classList.add('bg-blue-600');
      }
      if (knobEl) {
        knobEl.classList.remove('translate-x-0');
        knobEl.classList.add('translate-x-3');
      }
    } else {
      // Hide metrics
      panel.classList.add('hidden');
      if (textEl) textEl.textContent = 'Show Metrics';

      // Update switch state
      if (switchEl) {
        switchEl.classList.add(
          'bg-gray-200',
          'dark:bg-gray-700',
          'group-hover:bg-gray-300',
          'dark:group-hover:bg-gray-600'
        );
        switchEl.classList.remove('bg-blue-600');
      }
      if (knobEl) {
        knobEl.classList.add('translate-x-0');
        knobEl.classList.remove('translate-x-3');
      }
    }
  }
}

// Initialize performance metrics toggle button
const performanceMetricsInitHandler = () => {
  const toggleBtn = document.getElementById('toggle-performance-metrics');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', togglePerformanceMetrics);
  }
};

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', performanceMetricsInitHandler);
} else {
  // DOM already loaded, execute immediately
  performanceMetricsInitHandler();
}

function updateCacheIndicator(isCached, _cacheAge) {
  const indicator = document.getElementById('cache-indicator');
  if (indicator) {
    // Reset classes
    indicator.classList.remove('hidden', 'cache-tag-cached', 'cache-tag-live');
    indicator.classList.add('cache-tag');

    if (isCached) {
      indicator.innerHTML = `
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        Cached
      `;
      indicator.classList.add('cache-tag-cached');
    } else {
      indicator.innerHTML = `
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"></path>
        </svg>
        Live
      `;
      indicator.classList.add('cache-tag-live');

      // Show message if cache is disabled (user requested)
      if (!cacheEnabled) {
        // Check if we already showed this message to avoid spamming
        if (!window.hasShownCacheMessage) {
          vscode.postMessage({
            command: 'logError', // Using logError to show info message via extension
            data: 'Enable cache for faster scans',
          });
          window.hasShownCacheMessage = true;
        }
      }
    }
    indicator.classList.remove('hidden');
  }
}

/**
 * Get human-readable time ago string
 * @param {Date} date - The date to compare
 * @returns {string} Time ago string (e.g., "5 minutes ago", "2 hours ago")
 */
function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  }
  return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
}

/**
 * Show "No dependencies" empty state
 */
function showEmptyStateNoDeps() {
  // Hide dashboard content
  hideDashboardContent();
  hideEmptyStates(); // Hide other empty states first

  // Show empty state
  const emptyState = document.getElementById('empty-state-no-deps');
  if (emptyState) setVisibility(emptyState, true);
}

/**
 * Show "All healthy" success state
 */
function showEmptyStateHealthy() {
  // Hide table and charts but keep metrics
  const table = document.querySelector('.bg-white.dark\\:bg-gray-800.rounded-lg.shadow.border');
  const chartsSection = document.querySelector('.grid.grid-cols-1.lg\\:grid-cols-2.gap-6.mb-6');
  const filtersSection = document.querySelector(
    '.bg-white.dark\\:bg-gray-800.rounded-lg.shadow.p-4.mb-6'
  );

  if (table) table.classList.add('hidden');
  if (chartsSection) chartsSection.classList.add('hidden');
  if (filtersSection) filtersSection.classList.add('hidden');

  // Show empty state
  const emptyState = document.getElementById('empty-state-healthy');
  if (emptyState) setVisibility(emptyState, true);
}

/**
 * Hide all empty states
 */
function hideEmptyStates() {
  const noDepsState = document.getElementById('empty-state-no-deps');
  const healthyState = document.getElementById('empty-state-healthy');

  if (noDepsState) setVisibility(noDepsState, false);
  if (healthyState) setVisibility(healthyState, false);
}

// Expose test hooks for DOM-based unit tests (no impact in webview)
if (typeof window !== 'undefined') {
  window.__dpTestHooks = Object.assign(window.__dpTestHooks || {}, {
    setVisibility,
    showEmptyStateNoDeps,
    showEmptyStateHealthy,
    hideEmptyStates,
  });
}

/**
 * Hide dashboard content (for empty states)
 */
function hideDashboardContent() {
  const healthScoreCard = document.getElementById('health-score-card');
  const metricCards = document.querySelector(
    '.grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-4.gap-4.mb-6'
  );
  const chartsSection = document.querySelector('.grid.grid-cols-1.lg\\:grid-cols-2.gap-6.mb-6');
  const filtersSection = document.querySelector(
    '.bg-white.dark\\:bg-gray-800.rounded-lg.shadow.p-4.mb-6'
  );
  const table = document.querySelector('.bg-white.dark\\:bg-gray-800.rounded-lg.shadow.border');

  if (healthScoreCard) healthScoreCard.classList.add('hidden');
  if (metricCards) metricCards.classList.add('hidden');
  if (chartsSection) chartsSection.classList.add('hidden');
  if (filtersSection) filtersSection.classList.add('hidden');
  if (table) table.classList.add('hidden');
}

/**
 * Show dashboard content (after empty state)
 */
function showDashboardContent() {
  const healthScoreCard = document.getElementById('health-score-card');
  const metricCards = document.querySelector(
    '.grid.grid-cols-1.sm\\:grid-cols-2.lg\\:grid-cols-4.gap-4.mb-6'
  );
  const chartsSection = document.querySelector('.grid.grid-cols-1.lg\\:grid-cols-2.gap-6.mb-6');
  const filtersSection = document.querySelector(
    '.bg-white.dark\\:bg-gray-800.rounded-lg.shadow.p-4.mb-6'
  );
  const table = document.querySelector('.bg-white.dark\\:bg-gray-800.rounded-lg.shadow.border');

  if (healthScoreCard) healthScoreCard.classList.remove('hidden');
  if (metricCards) metricCards.classList.remove('hidden');
  if (chartsSection) chartsSection.classList.remove('hidden');
  if (filtersSection) filtersSection.classList.remove('hidden');
  if (table) table.classList.remove('hidden');
}

/**
 * Announce message to screen readers
 * @param {string} message - Message to announce
 */
function announceToScreenReader(message) {
  const announcement = document.getElementById('sr-announcements');
  if (announcement) {
    announcement.textContent = message;

    // Clear after announcement
    setTimeout(() => {
      announcement.textContent = '';
    }, 1000);
  }
}

/**
 * Update metric cards with values
 * @param {Object} metrics - Dashboard metrics
 */
function updateMetrics(metrics) {
  const totalEl = document.getElementById('metric-total');
  const criticalEl = document.getElementById('metric-critical');
  const highEl = document.getElementById('metric-high');
  const outdatedEl = document.getElementById('metric-outdated');
  const healthyEl = document.getElementById('metric-healthy');

  // Update values and remove shimmer loading animation
  if (totalEl) totalEl.textContent = metrics.analyzedDependencies || metrics.totalDependencies;
  if (criticalEl) {
    criticalEl.textContent = metrics.criticalIssues;
    criticalEl.classList.remove('shimmer-text');
  }
  if (highEl) {
    highEl.textContent = metrics.highIssues;
    highEl.classList.remove('shimmer-text');
  }
  if (outdatedEl) {
    outdatedEl.textContent = metrics.outdatedPackages;
    outdatedEl.classList.remove('shimmer-text');
  }
  if (healthyEl) {
    healthyEl.textContent = metrics.healthyPackages;
    healthyEl.classList.remove('shimmer-text');
  }

  // Update sparklines with appropriate colors (if function exists)
  if (typeof updateMetricWithSparkline === 'function') {
    updateMetricWithSparkline('critical', metrics.criticalIssues, '#ef4444');
    updateMetricWithSparkline('high', metrics.highIssues, '#f97316');
    updateMetricWithSparkline('outdated', metrics.outdatedPackages, '#f59e0b');
    updateMetricWithSparkline('healthy', metrics.healthyPackages, '#10b981');
  }
}

/**
 * Render current view (always table view)
 */
function renderCurrentView() {
  const tableView = document.querySelector('.bg-white.dark\\:bg-gray-800.rounded-lg.shadow.border');
  const cardView = document.getElementById('card-grid-view');
  const timelineView = document.getElementById('timeline-view');
  const heatmapView = document.getElementById('heatmap-view');
  const comparisonView = document.getElementById('comparison-view');

  // Hide all other views
  if (cardView) cardView.classList.add('hidden');
  if (timelineView) timelineView.classList.add('hidden');
  if (heatmapView) heatmapView.classList.add('hidden');
  if (comparisonView) comparisonView.classList.add('hidden');

  // Always show table view
  if (tableView) tableView.classList.remove('hidden');
  if (typeof tableManager !== 'undefined' && tableManager) {
    tableManager.render();
  }
}

/**
 * Error Handler Class
 * Manages error display and user-friendly error messages
 */
class ErrorHandler {
  /**
   * Show error in dashboard
   * @param {Error|string} error - Error object or message
   */
  showError(error) {
    // Hide loading states
    hideLoadingOverlay();
    hideChartSkeleton();

    // Get error container
    const errorContainer = document.getElementById('error-container');
    if (!errorContainer) {
      Logger.error('Error container not found');
      return;
    }

    // Get user-friendly message
    const errorMessage = typeof error === 'string' ? error : error.message;
    const userMessage = this.getUserFriendlyMessage(errorMessage);
    // Sanitize user-provided error message to prevent XSS
    const safeUserMessage = sanitizeText(userMessage);

    // Display error UI
    errorContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center p-12 text-center">
        <div class="text-6xl mb-4">⚠️</div>
        <h2 class="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
          Analysis Failed
        </h2>
        <p class="text-gray-600 dark:text-gray-400 mb-4 max-w-md">
          ${safeUserMessage}
        </p>
        <div class="flex gap-3">
          <button type="button"
                  data-action="retry-analysis" 
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium transition-colors">
            Retry
          </button>
          <button type="button"
                  data-action="view-logs" 
                  class="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded-md font-medium transition-colors">
            View Logs
          </button>
        </div>
      </div>
    `;
    errorContainer.classList.remove('hidden');

    // Log error to extension
    this.logError(error);

    // Re-enable refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('opacity-50', 'cursor-not-allowed');

      const refreshIcon = document.getElementById('refresh-icon');
      if (refreshIcon) {
        refreshIcon.classList.remove('spinning');
      }
    }
  }

  /**
   * Get user-friendly error message
   * @param {string} errorMessage - Technical error message
   * @returns {string} User-friendly message
   */
  getUserFriendlyMessage(errorMessage) {
    const message = errorMessage.toLowerCase();

    // Network errors
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection')
    ) {
      return 'Unable to connect to package registries. Please check your internet connection and try again.';
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'The analysis is taking longer than expected. This might be due to a slow network connection. Please try again.';
    }

    // Parse errors
    if (message.includes('parse') || message.includes('json') || message.includes('syntax')) {
      return 'Unable to read package.json. Please ensure it contains valid JSON and try again.';
    }

    // File not found errors
    if (message.includes('not found') || message.includes('enoent')) {
      return 'Could not find package.json in your workspace. Please ensure you have a valid Node.js project.';
    }

    // Permission errors
    if (message.includes('permission') || message.includes('eacces')) {
      return 'Permission denied while accessing project files. Please check file permissions and try again.';
    }

    // Rate limit errors
    if (message.includes('rate limit') || message.includes('429')) {
      return 'API rate limit exceeded. Please wait a few minutes before trying again, or configure a GitHub token in settings.';
    }

    // Generic error
    return 'An unexpected error occurred during analysis. Please try again or view logs for more details.';
  }

  /**
   * Handle retry button click
   */
  handleRetry() {
    // Hide error container
    const errorContainer = document.getElementById('error-container');
    if (errorContainer) {
      errorContainer.classList.add('hidden');
    }

    // Show loading overlay
    showLoadingOverlay('Retrying analysis...', 0);

    // Trigger refresh
    vscode.postMessage({ command: 'refresh' });
  }

  /**
   * Handle view logs button click
   */
  viewLogs() {
    // Send message to extension to open output channel
    vscode.postMessage({ command: 'viewLogs' });
  }

  /**
   * Log error to extension
   * @param {Error|string} error - Error to log
   */
  logError(error) {
    const errorData = {
      message: typeof error === 'string' ? error : error.message,
      stack: typeof error === 'object' && error.stack ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      dashboardState: {
        hasDependencies: window.currentDashboardData
          ? window.currentDashboardData.dependencies.length
          : 0,
        filters: filterManager ? filterManager.state : null,
      },
    };

    vscode.postMessage({
      command: 'logError',
      data: errorData,
    });
  }

  /**
   * Hide error display
   */
  hideError() {
    const errorContainer = document.getElementById('error-container');
    if (errorContainer) {
      errorContainer.classList.add('hidden');
    }
  }
}

// Initialize error handler
const errorHandler = new ErrorHandler();

/**
 * Export report in specified format
 * @param {string} format - Export format ('json' or 'csv')
 */
function exportReport(format) {
  if (!window.currentDashboardData) {
    Logger.warn('[Dashboard] Cannot export - no dashboard data available');
    errorHandler.showError('No data available to export. Please run a scan first.');
    return;
  }

  let content;
  let filename;

  if (format === 'json') {
    content = JSON.stringify(window.currentDashboardData, null, 2);
    filename = `deppulse-report-${getTimestamp()}.json`;
  } else {
    content = generateCSV(window.currentDashboardData);
    filename = `deppulse-report-${getTimestamp()}.csv`;
  }

  const exportScope = getExportScope(window.currentDashboardData);

  // Send export message to extension
  vscode.postMessage({
    command: 'exportReport',
    data: {
      format,
      filename,
      content,
      workspaceFolder: exportScope.workspaceFolder,
      packageRoot: exportScope.packageRoot,
    },
  });
}

function getExportScope(data) {
  const dependencies = Array.isArray(data?.dependencies) ? data.dependencies : [];
  const workspaceFolders = new Set(
    dependencies
      .map((dep) => dep.workspaceFolder)
      .filter((value) => typeof value === 'string' && value)
  );
  const packageRoots = new Set(
    dependencies.map((dep) => dep.packageRoot).filter((value) => typeof value === 'string' && value)
  );

  return {
    workspaceFolder: workspaceFolders.size === 1 ? Array.from(workspaceFolders)[0] : undefined,
    packageRoot: packageRoots.size === 1 ? Array.from(packageRoots)[0] : undefined,
  };
}

/**
 * Generate CSV content from dashboard data
 * @param {Object} data - Dashboard data
 * @returns {string} CSV content
 */
function generateCSV(data) {
  const headers = [
    'Package Name',
    'CVE IDs',
    'Severity',
    'Freshness',
    'CVSS Score',
    'Current Version',
    'Latest Version',
    'Last Updated',
  ];

  const rows = data.dependencies.map((dep) => [
    dep.packageName,
    dep.cveIds.join(', '),
    dep.severity,
    dep.freshness,
    dep.cvssScore != null
      ? dep.cvssVersion
        ? `${dep.cvssScore.toFixed(1)} (v${dep.cvssVersion})`
        : dep.cvssScore.toFixed(1)
      : '',
    dep.currentVersion,
    dep.latestVersion,
    formatDate(dep.lastUpdated),
  ]);

  // Escape and quote CSV cells
  const escapeCsvCell = (cell) => {
    const cellStr = String(cell);
    if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
      return `"${cellStr.replace(/"/g, '""')}"`;
    }
    return cellStr;
  };

  const csvRows = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));

  return csvRows.join('\n');
}

/**
 * Format date as YYYY-MM-DD
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date
 */
function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

/**
 * Get timestamp string for filenames
 * @returns {string} Timestamp string (YYYYMMDD-HHMMSS)
 */
function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Initialize filter event listeners
 * Sets up event handlers for search, severity filter, freshness filter, and per-page selector
 */
function initializeFilters() {
  // Wait for filterManager to be available
  if (typeof filterManager === 'undefined') {
    Logger.warn('[Dashboard] filterManager not available yet, retrying...');
    setTimeout(initializeFilters, 100);
    return;
  }

  // Wait for tableManager to be available
  if (typeof tableManager === 'undefined') {
    Logger.warn('[Dashboard] tableManager not available yet, retrying...');
    setTimeout(initializeFilters, 100);
    return;
  }

  Logger.log('[Dashboard] Initializing filter event listeners');

  // Search input with debouncing
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        filterManager.updateSearch(e.target.value);
      }, 300);
    });
    Logger.log('[Dashboard] Search input listener attached');
  } else {
    Logger.warn('[Dashboard] Search input not found');
  }

  // Severity filter dropdown
  const severityFilter = document.getElementById('severity-filter');
  if (severityFilter) {
    severityFilter.addEventListener('change', (e) => {
      filterManager.updateSeverity(e.target.value);
    });
    Logger.log('[Dashboard] Severity filter listener attached');
  } else {
    Logger.warn('[Dashboard] Severity filter not found');
  }

  // Freshness filter dropdown
  const freshnessFilter = document.getElementById('freshness-filter');
  if (freshnessFilter) {
    freshnessFilter.addEventListener('change', (e) => {
      filterManager.updateFreshness(e.target.value);
    });
    Logger.log('[Dashboard] Freshness filter listener attached');
  } else {
    Logger.warn('[Dashboard] Freshness filter not found');
  }

  // Per-page selector
  const perPageSelect = document.getElementById('per-page-select');
  if (perPageSelect) {
    perPageSelect.addEventListener('change', (e) => {
      const rowsPerPage = parseInt(e.target.value, 10);
      tableManager.setRowsPerPage(rowsPerPage);
      Logger.log('[Dashboard] Per-page changed to', rowsPerPage);
    });
    Logger.log('[Dashboard] Per-page selector listener attached');
  } else {
    Logger.warn('[Dashboard] Per-page selector not found');
  }

  // Clear filters button
  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      if (typeof clearAllFilters === 'function') {
        clearAllFilters();
      } else {
        filterManager.clearFilters();
      }
    });
    Logger.log('[Dashboard] Clear filters button listener attached');
  } else {
    Logger.warn('[Dashboard] Clear filters button not found');
  }

  // Pagination buttons
  const prevBtn = document.getElementById('prev-page-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      tableManager.prevPage();
    });
    Logger.log('[Dashboard] Previous page button listener attached');
  }

  const nextBtn = document.getElementById('next-page-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      tableManager.nextPage();
    });
    Logger.log('[Dashboard] Next page button listener attached');
  }

  // Bulk update button
  const bulkUpdateBtn = document.getElementById('bulk-update-btn');
  if (bulkUpdateBtn) {
    bulkUpdateBtn.addEventListener('click', () => {
      tableManager.executeBulkUpdate();
    });
    Logger.log('[Dashboard] Bulk update button listener attached');
  }

  console.log('[Dashboard] Filter event listeners initialized');
}
