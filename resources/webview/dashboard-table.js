// DepPulse Dashboard - Table and Card Rendering
// CardManager and TableManager classes for dependency display

// Note: Uses state from dashboard-state.js, utils from dashboard-utils.js
// Note: This file is large (~1400 lines) containing both CardManager and TableManager

// Prevent duplicate class declarations
if (typeof window.CardManager === 'undefined') {
  window.CardManager = class CardManager {
    constructor() {
      this.allDependencies = [];
      this.filteredDependencies = [];
      this.currentPage = 1;
      this.rowsPerPage = 12; // 4x3 grid
      this.layout = 'grid-3'; // 'grid-2', 'grid-3', 'grid-4', 'masonry'
      this.isSinglePackageProject = false;
    }

    setData(dependencies) {
      this.isSinglePackageProject = Boolean(window.isSinglePackageProject);
      this.allDependencies = dependencies;
      this.filteredDependencies = dependencies;
      this.currentPage = 1;
      this.render();
    }

    setLayout(layout) {
      this.layout = layout;
      // Adjust rows per page based on layout
      switch (layout) {
        case 'grid-2':
          this.rowsPerPage = 8; // 4 rows x 2 cols
          break;
        case 'grid-4':
          this.rowsPerPage = 16; // 4 rows x 4 cols
          break;
        case 'masonry':
          this.rowsPerPage = 20; // Show more for masonry
          break;
        default: // grid-3
          this.rowsPerPage = 12; // 4 rows x 3 cols
      }
      this.currentPage = 1;
    }

    getLayoutClasses() {
      switch (this.layout) {
        case 'grid-2':
          return 'grid grid-cols-1 md:grid-cols-2 gap-4';
        case 'grid-4':
          return 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4';
        case 'masonry':
          return 'masonry-grid';
        default: // grid-3
          return 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4';
      }
    }

    render() {
      const container = document.getElementById('dependency-card-grid');
      if (!container) return;

      // Update container classes for layout
      container.className = `${this.getLayoutClasses()} mb-6`;

      const paginatedData = this.getPaginatedData();

      if (paginatedData.length === 0) {
        container.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center p-12 text-center">
          <div class="text-6xl mb-4">📭</div>
          <p class="text-gray-500 dark:text-gray-400">No dependencies found</p>
        </div>
      `;
      } else {
        container.innerHTML = paginatedData.map((dep) => this.renderCard(dep)).join('');

        // If masonry layout, initialize masonry after rendering
        if (this.layout === 'masonry') {
          this.initMasonryLayout();
        }
      }

      this.renderPagination();
    }

    initMasonryLayout() {
      // Add CSS for masonry layout if not already added
      if (!document.getElementById('masonry-style')) {
        const style = document.createElement('style');
        style.id = 'masonry-style';
        style.textContent = `
        .masonry-grid {
          column-count: 1;
          column-gap: 1rem;
        }
        @media (min-width: 768px) {
          .masonry-grid {
            column-count: 2;
          }
        }
        @media (min-width: 1280px) {
          .masonry-grid {
            column-count: 3;
          }
        }
        .masonry-grid > * {
          break-inside: avoid;
          margin-bottom: 1rem;
        }
      `;
        document.head.appendChild(style);
      }
    }

    renderCard(dep) {
      const rowKey = dep.rowKey || dep.packageName;
      const workspaceFolder =
        this.isSinglePackageProject || !dep.workspaceFolder ? '' : dep.workspaceFolder;
      const packageRoot = this.isSinglePackageProject || !dep.packageRoot ? '' : dep.packageRoot;
      const safePackageNameAttr = escapeAttribute(dep.packageName);
      const safePackageName = escapeHtml(dep.packageName);
      const safeSeverity = escapeHtml(dep.severity);
      const safeCurrentVersion = escapeHtml(dep.currentVersion);
      const safeLatestVersion = escapeHtml(dep.latestVersion);
      const safeLatestVersionAttr = escapeAttribute(dep.latestVersion);
      const safeRowKey = escapeAttribute(rowKey);
      const safeWorkspaceFolder = escapeAttribute(workspaceFolder);
      const safePackageRoot = escapeAttribute(packageRoot);
      const severityGradients = {
        critical: 'from-red-500 to-red-600',
        high: 'from-orange-500 to-orange-600',
        medium: 'from-yellow-500 to-yellow-600',
        low: 'from-yellow-400 to-yellow-500',
        none: 'from-green-500 to-green-600',
      };

      const freshnessColors = {
        current: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200',
        patch: 'bg-lime-100 dark:bg-lime-900 text-lime-800 dark:text-lime-200',
        minor: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200',
        major: 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200',
        unmaintained: 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200',
      };

      const gradient = severityGradients[dep.severity] || severityGradients.none;
      const freshnessColor = freshnessColors[dep.freshness] || freshnessColors.current;
      const isFlipped = flippedCards.has(dep.packageName);

      return `
      <div class="flip-card-container" style="perspective: 1000px;">
        <div class="flip-card ${isFlipped ? 'flipped' : ''}" style="position: relative; transform-style: preserve-3d; transition: transform 0.6s;" data-package="${safePackageNameAttr}">
          <!-- Front of Card -->
      <div class="group bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl border border-gray-200 dark:border-gray-700 transition-all duration-300 hover:-translate-y-1 overflow-hidden animate-fade-in">
        <!-- Card Header with Gradient -->
        <div class="bg-linear-to-r ${gradient} p-4 text-white">
          <div class="flex items-center justify-between mb-2">
            <h3 class="font-mono font-semibold text-lg truncate pr-2" title="${safePackageNameAttr}">
              ${safePackageName}
            </h3>
            <span class="text-xs font-medium px-2 py-1 bg-white bg-opacity-30 rounded-full shrink-0">
              ${safeSeverity.toUpperCase()}
            </span>
          </div>
          <div class="flex items-center gap-2 text-sm opacity-90">
            <span class="font-mono">${safeCurrentVersion}</span>
            ${
              dep.hasUpdate
                ? `
              <span>→</span>
              <span class="font-mono font-semibold">${safeLatestVersion}</span>
            `
                : ''
            }
          </div>
        </div>

        <!-- Card Body -->
        <div class="p-4 space-y-3">
          <!-- Freshness Badge -->
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Freshness</span>
            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${freshnessColor}">
              ${dep.freshness.charAt(0).toUpperCase() + dep.freshness.slice(1)}
            </span>
          </div>

          <!-- CVE Count -->
          ${
            dep.cveIds.length > 0
              ? `
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Vulnerabilities</span>
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                </svg>
                ${dep.cveIds.length}
              </span>
            </div>
          `
              : `
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400">Security</span>
              <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                </svg>
                No issues
              </span>
            </div>
          `
          }

          <!-- CVSS Score -->
          ${
            dep.cvssScore !== null
              ? `
            <div class="flex items-center justify-between">
              <span class="text-xs font-medium text-gray-600 dark:text-gray-400">CVSS Score</span>
              <span class="text-sm font-bold text-red-600 dark:text-red-400">
                ${dep.cvssScore.toFixed(1)}${dep.cvssVersion ? ` (v${dep.cvssVersion})` : ''}
              </span>
            </div>
          `
              : ''
          }

          <!-- Last Updated -->
          <div class="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Last updated</span>
            <span>${this.formatRelativeTime(dep.lastUpdated)}</span>
          </div>
        </div>

        <!-- Card Footer -->
        <div class="px-4 pb-4 flex gap-2">
          ${
            dep.hasUpdate
              ? `
            <button class="update-btn flex-1 px-3 py-2 bg-gradient-blue text-white rounded-lg text-sm font-medium transition-all hover:shadow-lg flex items-center justify-center gap-1" 
                    data-package="${safePackageNameAttr}" 
                    data-version="${safeLatestVersionAttr}"
                    data-row-key="${safeRowKey}"
                    data-workspace="${safeWorkspaceFolder}"
                    data-package-root="${safePackageRoot}"
                    title="Update to ${safeLatestVersionAttr}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <path d="M7 17L17 7"/>
                <path d="M7 7h10v10"/>
              </svg>
              Update
            </button>
          `
              : `
            <button class="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg text-sm font-medium cursor-not-allowed" disabled>
              Up to date
            </button>
          `
          }
          ${
            dep.cveIds.length > 0
              ? `
            <button class="view-details-btn px-3 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors" 
                    data-package="${safePackageNameAttr}"
                    title="View vulnerability details">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
              </svg>
            </button>
          `
              : ''
          }
        </div>
      </div>
    `;
    }

    formatRelativeTime(date) {
      const now = new Date();
      const then = new Date(date);
      const diffMs = now - then;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 30) return `${diffDays} days ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
      return `${Math.floor(diffDays / 365)} years ago`;
    }

    getPaginatedData() {
      const start = (this.currentPage - 1) * this.rowsPerPage;
      const end = start + this.rowsPerPage;
      return this.filteredDependencies.slice(start, end);
    }

    renderPagination() {
      const totalPages = Math.ceil(this.filteredDependencies.length / this.rowsPerPage);
      const start = (this.currentPage - 1) * this.rowsPerPage + 1;
      const end = Math.min(this.currentPage * this.rowsPerPage, this.filteredDependencies.length);

      const pageIndicator = document.getElementById('card-page-indicator');
      const paginationInfo = document.getElementById('card-pagination-info');
      const prevBtn = document.getElementById('card-prev-page-btn');
      const nextBtn = document.getElementById('card-next-page-btn');

      if (pageIndicator) {
        pageIndicator.textContent = `Page ${this.currentPage} of ${totalPages || 1}`;
      }

      if (paginationInfo) {
        paginationInfo.textContent = `Showing ${start}-${end} of ${this.filteredDependencies.length} dependencies`;
      }

      if (prevBtn) {
        prevBtn.disabled = this.currentPage === 1;
      }

      if (nextBtn) {
        nextBtn.disabled = this.currentPage >= totalPages;
      }
    }

    nextPage() {
      const totalPages = Math.ceil(this.filteredDependencies.length / this.rowsPerPage);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.render();
        // Scroll to top of cards
        document
          .getElementById('dependency-card-grid')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.render();
        // Scroll to top of cards
        document
          .getElementById('dependency-card-grid')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  // Initialize card manager
  if (!window.cardManager) {
    window.cardManager = new window.CardManager();
  }
}

// Prevent duplicate class declarations
if (typeof window.TableManager === 'undefined') {
  window.TableManager = class TableManager {
    constructor() {
      this.allDependencies = [];
      this.filteredDependencies = [];
      this.currentPage = 1;
      this.rowsPerPage = 10;
      this.selectedRows = new Set();
      this.expandedRow = null;
      this.sortColumn = null;
      this.sortDirection = 'asc';
      this.density = 'comfortable'; // 'compact', 'comfortable', 'spacious'
      this.useVirtualScrolling = false;
      this.virtualScrollContainer = null;
      this.virtualScrollThreshold = 2000; // Enable virtual scroll only for very large lists
      this.lastStartIndex = 0; // Track last rendered start index for virtual scrolling
      this.expandedCVERows = new Set();
      this.isSinglePackageProject = false;
    }

    setData(dependencies) {
      this.isSinglePackageProject = Boolean(window.isSinglePackageProject);
      this.allDependencies = dependencies;
      this.filteredDependencies = dependencies;
      this.currentPage = 1;
      this.expandedCVERows.clear();

      // Enable virtual scrolling if we have many dependencies
      this.useVirtualScrolling = dependencies.length > this.virtualScrollThreshold;

      if (this.useVirtualScrolling && !this.virtualScrollContainer) {
        this.setupVirtualScrolling();
      }

      this.render();
    }

    setupVirtualScrolling() {
      const tableContainer =
        document.getElementById('table-scroll-region') ||
        document.querySelector('.overflow-x-auto');
      if (!tableContainer) return;

      // Add scroll listener for virtual scrolling
      this.virtualScrollContainer = tableContainer;
      tableContainer.addEventListener('scroll', () => {
        if (this.useVirtualScrolling) {
          this.handleVirtualScroll();
        }
      });
    }

    handleVirtualScroll() {
      if (!this.virtualScrollContainer) return;

      const scrollTop = this.virtualScrollContainer.scrollTop;
      const containerHeight = this.virtualScrollContainer.clientHeight;

      // Calculate which items should be visible
      const itemHeight = virtualScrollState.itemHeight;
      const buffer = virtualScrollState.buffer;

      const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
      const endIndex = Math.min(
        this.filteredDependencies.length,
        Math.ceil((scrollTop + containerHeight) / itemHeight) + buffer
      );

      // Update state
      virtualScrollState.startIndex = startIndex;
      virtualScrollState.endIndex = endIndex;
      virtualScrollState.scrollTop = scrollTop;
      virtualScrollState.totalItems = this.filteredDependencies.length;

      // Re-render only if indices changed significantly
      if (Math.abs(this.lastStartIndex - startIndex) > buffer / 2) {
        this.lastStartIndex = startIndex;
        this.renderVirtual();
      }
    }

    renderVirtual() {
      const tbody = document.getElementById('dependency-table-body');
      if (!tbody) return;

      const { startIndex, endIndex } = virtualScrollState;
      const visibleDeps = this.filteredDependencies.slice(startIndex, endIndex);

      // Calculate offset for positioning
      const itemHeight = virtualScrollState.itemHeight;
      const offsetY = startIndex * itemHeight;

      // Render only visible rows with offset
      tbody.innerHTML = `
      <tr style="height: ${offsetY}px;"><td></td></tr>
      ${visibleDeps.map((dep) => this.renderRow(dep)).join('')}
      <tr style="height: ${(this.filteredDependencies.length - endIndex) * itemHeight}px;"><td></td></tr>
    `;

      this.updateTableHeader();
      this.updateHeaderCheckboxState();
    }

    setRowsPerPage(rows) {
      this.rowsPerPage = rows;
      this.currentPage = 1; // Reset to first page
      this.render();
    }

    setDensity(density) {
      this.density = density;
    }

    getDensityClasses() {
      switch (this.density) {
        case 'compact':
          return 'px-3 py-2';
        case 'spacious':
          return 'px-5 py-5';
        default: // comfortable
          return 'px-4 py-3';
      }
    }

    // Flaticon-inspired glyphs for consistent arrow language
    getSortIcon(direction = 'neutral') {
      switch (direction) {
        case 'asc':
          return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 15l4-5 4 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <path d="M12 4v10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        `;
        case 'desc':
          return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 9l4 5 4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <path d="M12 10v10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        `;
        default:
          return `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l3-3 3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <path d="M9 18l3 3 3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <path d="M12 4v16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        `;
      }
    }

    render() {
      // Use virtual scrolling for large datasets
      if (
        this.useVirtualScrolling &&
        this.filteredDependencies.length > this.virtualScrollThreshold
      ) {
        this.renderVirtual();
        this.renderPagination();
        return;
      }

      // Normal rendering for smaller datasets
      const tbody = document.getElementById('dependency-table-body');
      if (!tbody) return;

      const paginatedData = this.getPaginatedData();
      const visibleColumnCount = Object.values(visibleColumns).filter((v) => v).length;

      if (paginatedData.length === 0) {
        tbody.innerHTML = `
        <tr>
          <td colspan="${visibleColumnCount}" class="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
            No dependencies found
          </td>
        </tr>
      `;
      } else {
        tbody.innerHTML = paginatedData.map((dep) => this.renderRow(dep)).join('');
      }

      this.updateTableHeader();
      this.renderPagination();
      this.updateHeaderCheckboxState();
    }

    updateTableHeader() {
      // Update table header to show/hide columns (using modern header structure)
      const thead = document.querySelector('thead');
      if (!thead) return;

      const headerRow = thead.querySelector('tr');
      if (!headerRow) return;

      const neutralIcon = this.getSortIcon('neutral');

      const headers = [
        {
          key: 'packageName',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="packageName"><div class="flex items-center gap-3"><input type="checkbox" id="select-all" class="smart-checkbox-input shrink-0 self-center -ml-2" aria-label="Select all dependencies" data-action="toggle-select-all"><span class="flex items-center gap-1">Package <span class="sort-indicator" aria-hidden="true">${neutralIcon}</span></span></div></th>`,
          alwaysVisible: true,
        },
        {
          key: 'cveIds',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">CVE IDs</th>`,
        },
        {
          key: 'severity',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="severity"><div class="flex items-center justify-between gap-2"><span>Severity</span><span class="sort-indicator" aria-hidden="true">${neutralIcon}</span></div></th>`,
        },
        {
          key: 'freshness',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">Freshness</th>`,
        },
        {
          key: 'compatibility',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">Compatibility</th>`,
        },
        {
          key: 'cvssScore',
          html: `<th scope="col" class="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="cvssScore"><div class="flex items-center justify-end gap-2"><span>CVSS</span><span class="sort-indicator" aria-hidden="true">${neutralIcon}</span></div></th>`,
        },
        {
          key: 'currentVersion',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">Current</th>`,
        },
        {
          key: 'latestVersion',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">Latest</th>`,
        },
        {
          key: 'lastUpdated',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 transition-colors" data-sort="lastUpdated"><div class="flex items-center justify-between gap-2"><span>Last Updated</span><span class="sort-indicator" aria-hidden="true">${neutralIcon}</span></div></th>`,
        },
        {
          key: 'actions',
          html: `<th scope="col" class="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">Actions</th>`,
        },
      ];

      headerRow.innerHTML = headers
        .filter((h) => h.alwaysVisible || visibleColumns[h.key])
        .map((h) => h.html)
        .join('');

      // Update sort indicators after header update
      this.updateSortIndicators();
      wireSelectAllCheckbox();
    }

    renderRow(dep) {
      const rowKey = dep.rowKey || dep.packageName;
      const isSelected = this.selectedRows.has(rowKey);
      const isExpanded = this.expandedRow === rowKey;
      const safePackageName = escapeHtml(dep.packageName);
      const safePackageNameAttr = escapeAttribute(dep.packageName);
      const safeRowKey = escapeAttribute(rowKey);
      const safeSeverity = escapeHtml(dep.severity);
      const safeSeverityAttr = escapeAttribute(dep.severity);
      const safeCurrentVersion = escapeHtml(dep.currentVersion);
      const safeLatestVersion = escapeHtml(dep.latestVersion);
      const safeScopeTitle = escapeAttribute(dep.packageRoot || dep.workspaceFolder || '');
      const severityClass = this.getSeverityBorderClass(dep.severity);
      const paddingClasses = this.getDensityClasses();
      const densityClasses = `${paddingClasses} align-middle`;
      const severityDot = this.getSeverityDotClass(dep.severity);
      const shouldShowScope =
        !this.isSinglePackageProject && (dep.packageRoot || dep.workspaceFolder);

      let html = `
      <tr class="row-main table-row-modern ${severityClass} group border-b border-gray-100/70 dark:border-gray-800/60 cursor-pointer transition-colors duration-150 hover:bg-gray-50/70 dark:hover:bg-gray-800/40 focus-within:bg-blue-50/40 dark:focus-within:bg-blue-900/20" 
          data-package="${safePackageNameAttr}"
          data-row-key="${safeRowKey}"
          tabindex="0" 
          role="row" 
          aria-label="Dependency: ${safePackageNameAttr}, Severity: ${safeSeverityAttr}, ${dep.cveIds.length} vulnerabilities">
        <td class="${densityClasses}">
          <div class="flex items-center gap-3">
            <input type="checkbox" 
                   class="row-checkbox smart-checkbox-input shrink-0" 
                   data-package="${safePackageNameAttr}"
                   data-row-key="${safeRowKey}"
                   aria-label="Select ${safePackageNameAttr}"
                   ${isSelected ? 'checked' : ''}>
            <button class="expand-toggle-modern ${isExpanded ? 'expanded' : ''} shrink-0" 
                    data-package="${safePackageNameAttr}"
                    data-row-key="${safeRowKey}"
                    aria-label="Toggle details for ${safePackageNameAttr}" 
                    aria-expanded="${isExpanded}"
                    title="Click to ${isExpanded ? 'collapse' : 'expand'} details">
              <svg class="expand-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor">
                <path d="M6 8l4 4 4-4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <span class="inline-flex h-3 w-3 rounded-full ${severityDot} shrink-0 ring-2 ring-white dark:ring-gray-800 ${dep.severity === 'critical' ? 'dot-pulse-critical' : ''}" aria-hidden="true" title="Severity: ${safeSeverityAttr}"></span>
              <span class="font-semibold text-gray-900 dark:text-gray-100 truncate">${safePackageName}</span>
              <span class="sr-only">Severity ${safeSeverity}</span>
              ${
                shouldShowScope
                  ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200/80 dark:border-gray-700/80 truncate max-w-[160px]" title="${safeScopeTitle}">
                    ${this.formatWorkspaceLabel(dep)}
                  </span>`
                  : ''
              }
              ${
                window.transitiveEnabled && this.hasTransitiveVulns(dep)
                  ? (
                      () => {
                        const count = Math.min(this.countTransitiveVulns(dep), 99);
                        const tooltip =
                          count > 0
                            ? `Transitive vulnerabilities detected (${count})`
                            : 'Transitive vulnerabilities detected';
                        return `
                        <span class="relative inline-flex items-center" aria-label="${tooltip}">
                          <button class="transitive-indicator-btn inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-blue-700 dark:text-blue-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                                  type="button"
                                  data-action="view-transitive"
                                  data-package="${safePackageNameAttr}"
                                  data-row-key="${safeRowKey}"
                                  aria-label="${tooltip}"
                                  title="${tooltip}">
                            <svg class="transitive-icon h-4 w-4 text-blue-600 dark:text-blue-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true">
                              <circle cx="10" cy="10" r="8" stroke-width="1.5"></circle>
                              <line x1="10" y1="6" x2="10" y2="11" stroke-width="1.5" stroke-linecap="round"></line>
                              <circle cx="10" cy="14" r="1" fill="currentColor"></circle>
                            </svg>
                            <span class="text-[10px] font-semibold">${count}</span>
                          </button>
                          <span class="tooltip-bubble pointer-events-none absolute left-1/2 -translate-x-1/2 -top-12 flex flex-col items-center transition-all duration-150 ease-out opacity-0" aria-hidden="true">
                            <span class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 whitespace-nowrap">
                              ${tooltip}
                            </span>
                            <span class="h-2 w-2 rotate-45 bg-slate-900 -mt-1 border-r border-b border-white/10"></span>
                          </span>
                        </span>`;
                      }
                    )()
                  : ''
              }
            </div>
          </div>
        </td>
        ${
          visibleColumns.cveIds
            ? `
        <td class="${densityClasses}">
          ${this.renderCVELinks(dep)}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.severity
            ? `
        <td class="${densityClasses}">
          ${this.renderSeverityChip(dep.severity)}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.freshness
            ? `
        <td class="${densityClasses}">
          ${this.renderFreshnessChip(dep.freshness)}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.compatibility
            ? `
        <td class="${densityClasses}">
          ${this.renderCompatibilityChip(dep.compatibility)}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.cvssScore
            ? `
        <td class="${densityClasses} text-center font-semibold text-gray-900 dark:text-gray-100">
          ${dep.cvssScore != null ? (dep.cvssVersion ? `${dep.cvssScore.toFixed(1)} (v${dep.cvssVersion})` : dep.cvssScore.toFixed(1)) : '-'}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.currentVersion
            ? `
        <td class="${densityClasses} font-mono text-sm text-gray-700 dark:text-gray-300">
          ${safeCurrentVersion}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.latestVersion
            ? `
        <td class="${densityClasses} font-mono text-sm text-gray-700 dark:text-gray-300">
          ${safeLatestVersion}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.lastUpdated
            ? `
        <td class="${densityClasses} text-sm text-gray-600 dark:text-gray-400">
          ${this.formatRelativeTime(dep.lastUpdated)}
        </td>
        `
            : ''
        }
        ${
          visibleColumns.actions
            ? `
        <td class="${densityClasses} text-left">
          <div class="flex items-center justify-start gap-2">
            ${this.renderActionButtons(dep)}
          </div>
        </td>
        `
            : ''
        }
      </tr>
    `;

      if (isExpanded) {
        html += this.renderExpandedRow(dep);
      }

      return html;
    }

    shouldShowUpdateAction(dep) {
      return (
        dep.hasUpdate ||
        (dep.latestVersion && dep.currentVersion && dep.latestVersion !== dep.currentVersion)
      );
    }

    formatWorkspaceLabel(dep) {
      if (this.isSinglePackageProject) return '';
      const label = dep.packageRoot || dep.workspaceFolder;
      if (!label) return '';
      const normalized = label.replace(/\\/g, '/');
      const parts = normalized.split('/').filter(Boolean);
      const lastTwo = parts.slice(-2).join('/');
      return lastTwo || normalized;
    }

    // Action icons follow the Flaticon rounded-outline style for familiarity
    renderActionButtons(dep) {
      const buttons = [];
      const rowKey = dep.rowKey || dep.packageName;
      const workspaceFolder =
        this.isSinglePackageProject || !dep.workspaceFolder ? '' : dep.workspaceFolder;
      const packageRoot = this.isSinglePackageProject || !dep.packageRoot ? '' : dep.packageRoot;
      const safePackageNameAttr = escapeAttribute(dep.packageName);
      const safeLatestVersionAttr = escapeAttribute(dep.latestVersion);
      const safeRowKey = escapeAttribute(rowKey);
      const safeWorkspaceFolder = escapeAttribute(workspaceFolder);
      const safePackageRoot = escapeAttribute(packageRoot);

      const needsUpdate = this.shouldShowUpdateAction(dep);
      const updateTooltipText =
        dep.latestVersion && dep.latestVersion !== dep.currentVersion
          ? `Update to ${dep.latestVersion}`
          : 'Update dependency';
      const viewTooltipText =
        dep.cveIds.length > 1
          ? `View ${dep.cveIds.length} vulnerabilities`
          : 'View vulnerability details';
      const wrapWithTooltip = (buttonMarkup, tooltipText) => `
        <span class="relative inline-flex">
          ${buttonMarkup}
          <span class="tooltip-bubble pointer-events-none absolute left-1/2 -translate-x-1/2 -top-12 flex flex-col items-center transition-all duration-150 ease-out opacity-0" aria-hidden="true">
            <span class="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-lg shadow-slate-900/40 border border-white/10 whitespace-nowrap">
              ${tooltipText}
            </span>
            <span class="h-2 w-2 rotate-45 bg-slate-900 -mt-1 border-r border-b border-white/10"></span>
          </span>
        </span>
      `;

      if (needsUpdate) {
        buttons.push(
          wrapWithTooltip(
            `
          <button class="table-action-btn primary update-btn" 
                  data-package="${safePackageNameAttr}" 
                  data-version="${safeLatestVersionAttr}"
                  data-row-key="${safeRowKey}"
                  data-workspace="${safeWorkspaceFolder}"
                  data-package-root="${safePackageRoot}"
                  aria-label="Update ${safePackageNameAttr} to ${safeLatestVersionAttr}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M7 17L17 7"/>
              <path d="M7 7h10v10"/>
            </svg>
          </button>
        `,
            updateTooltipText
          )
        );
      }

      if (dep.cveIds.length > 0) {
        buttons.push(
          wrapWithTooltip(
            `
          <button class="table-action-btn" 
                  data-action="view-vulns" 
                  data-package="${safePackageNameAttr}" 
                  data-row-key="${safeRowKey}"
                  aria-label="View ${dep.cveIds.length} vulnerability${dep.cveIds.length > 1 ? 'ies' : ''} for ${safePackageNameAttr}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3l7 4v5c0 4.25-3 8.25-7 9-4-0.75-7-4.75-7-9V7l7-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <path d="M12 9.5a2.5 2.5 0 012.5 2.5v1a2.5 2.5 0 11-5 0v-1A2.5 2.5 0 0112 9.5z" fill="currentColor"/>
            </svg>
          </button>
        `,
            viewTooltipText
          )
        );
      }

      return buttons.join('');
    }

    renderExpandedRow(dep) {
      const visibleColumnCount = Object.values(visibleColumns).filter((v) => v).length;
      const showAlternativesTab = dep.alternativesEligible === true;
      const showTransitiveTab = window.transitiveEnabled && dep.children && dep.children.length > 0;
      const rowKey = dep.rowKey || dep.packageName;
      const safePackageNameAttr = escapeAttribute(dep.packageName);
      const safeRowKey = escapeAttribute(rowKey);

      return `
      <tr class="expanded-row animate-fade-in" data-package-name="${safePackageNameAttr}" data-row-key="${safeRowKey}">
        <td colspan="${visibleColumnCount}" class="px-6 py-4 bg-gray-50/30 dark:bg-gray-900/30">
          <div class="ml-10 space-y-4 max-w-5xl">
            <!-- Tabbed Interface for Expanded View -->
            <div class="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <!-- Tab Headers -->
              <div class="flex border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-x-auto">
                <button class="expanded-tab active px-4 py-3 text-sm font-medium text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 whitespace-nowrap" data-tab="overview" data-row-key="${safeRowKey}" data-package="${safePackageNameAttr}">
                  Overview
                </button>
                <button class="expanded-tab px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 whitespace-nowrap" data-tab="vulnerabilities" data-row-key="${safeRowKey}" data-package="${safePackageNameAttr}">
                  Vulnerabilities ${dep.cveIds.length > 0 ? `(${dep.cveIds.length})` : ''}
                </button>
                ${
                  dep.compatibility && dep.compatibility.issues.length > 0
                    ? `<button class="expanded-tab px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 whitespace-nowrap" data-tab="compatibility" data-row-key="${safeRowKey}" data-package="${safePackageNameAttr}">
                        Compatibility ${dep.compatibility.issues.length > 0 ? `(${dep.compatibility.issues.length})` : ''}
                      </button>`
                    : ''
                }
                ${
                  dep.license
                    ? `<button class="expanded-tab px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 whitespace-nowrap" data-tab="license" data-row-key="${safeRowKey}" data-package="${safePackageNameAttr}">
                        <span class="inline-flex items-center gap-1.5">
                          License
                          ${
                            !dep.license.isCompatible
                              ? `<svg class="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/>
                                </svg>`
                              : ''
                          }
                        </span>
                      </button>`
                    : ''
                }
                ${
                  showTransitiveTab
                    ? `<button class="expanded-tab px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 whitespace-nowrap" data-tab="transitive" data-row-key="${safeRowKey}" data-package="${safePackageNameAttr}">
                    Transitive Dependencies
                  </button>`
                    : ''
                }
                <button class="expanded-tab px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 whitespace-nowrap" data-tab="actions" data-row-key="${safeRowKey}" data-package="${safePackageNameAttr}">
                  Actions
                </button>
                ${
                  showAlternativesTab
                    ? `<button class="expanded-tab px-4 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 whitespace-nowrap" data-tab="alternatives" data-row-key="${safeRowKey}" data-package="${safePackageNameAttr}">
                    Alternatives
                  </button>`
                    : ''
                }
              </div>
              
              <!-- Tab Content -->
              <div class="p-4">
                <!-- Overview Tab -->
                <div class="tab-content active" data-tab-content="overview">
                  ${this.renderPackageInfo(dep)}
                </div>
                
                <!-- Vulnerabilities Tab -->
                <div class="tab-content hidden" data-tab-content="vulnerabilities">
                  ${dep.cveIds.length > 0 ? this.renderVulnerabilityDetails(dep) : this.renderNoVulnerabilities()}
                </div>

                <!-- Compatibility Tab -->
                ${
                  dep.compatibility
                    ? `<div class="tab-content hidden" data-tab-content="compatibility">
                        ${this.renderCompatibilityTab(dep)}
                      </div>`
                    : ''
                }

                <!-- License Tab -->
                ${
                  dep.license
                    ? `<div class="tab-content hidden" data-tab-content="license">
                        ${this.renderLicenseTab(dep)}
                      </div>`
                    : ''
                }

                <!-- Transitive Dependencies Tab -->
                ${
                  showTransitiveTab
                    ? `<div class="tab-content hidden" data-tab-content="transitive">
                    ${this.renderTransitiveTab(dep)}
                  </div>`
                    : ''
                }
                
                <!-- Actions Tab -->
                <div class="tab-content hidden" data-tab-content="actions">
                  ${this.renderActionsTab(dep)}
                </div>
                ${showAlternativesTab ? this.renderAlternativesTab(dep) : ''}
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
    }

    renderActionsTab(dep) {
      const rowKey = dep.rowKey || dep.packageName;
      const workspaceFolder =
        this.isSinglePackageProject || !dep.workspaceFolder ? '' : dep.workspaceFolder;
      const packageRoot = this.isSinglePackageProject || !dep.packageRoot ? '' : dep.packageRoot;
      const safePackageNameAttr = escapeAttribute(dep.packageName);
      const safeLatestVersion = escapeHtml(dep.latestVersion);
      const safeLatestVersionAttr = escapeAttribute(dep.latestVersion);
      const safeRowKey = escapeAttribute(rowKey);
      const safeWorkspaceFolder = escapeAttribute(workspaceFolder);
      const safePackageRoot = escapeAttribute(packageRoot);
      const sections = [];
      // Validate and normalize repository URL - only use repositoryUrl, not homepageUrl
      // Only show repository link if it's from a valid open source hosting service
      let repoLink = null;
      if (dep.repositoryUrl && this.isValidRepositoryUrl(dep.repositoryUrl)) {
        const normalizeFn =
          typeof window.normalizeRepositoryUrl === 'function'
            ? window.normalizeRepositoryUrl
            : (url) => {
                if (!url) return '';
                // Fallback normalization if window.normalizeRepositoryUrl is not available
                let cleanUrl = url.replace(/^git\+/, '');
                // Handle git:// protocol (convert to https://)
                cleanUrl = cleanUrl.replace(/^git:\/\//, 'https://');
                cleanUrl = cleanUrl.replace(/\.git$/, '');
                cleanUrl = cleanUrl.replace(/^ssh:\/\/git@/, 'https://');
                cleanUrl = cleanUrl.replace(/^git@([^:]+):/, 'https://$1/');
                return cleanUrl;
              };
        const normalized = normalizeFn(dep.repositoryUrl);
        // Ensure URL doesn't have trailing slash and is a valid HTTPS URL
        if (normalized && normalized.trim()) {
          const cleaned = normalized.replace(/\/$/, '');
          // Validate that the final URL is a valid HTTPS URL
          try {
            const urlObj = new URL(cleaned);
            // Only accept HTTPS URLs (not git://, http://, etc.)
            if (urlObj.protocol === 'https:') {
              repoLink = cleaned;
            }
          } catch {
            // Invalid URL format, don't show link
            repoLink = null;
          }
        }
      }
      const remediationButtons = [];

      if (this.shouldShowUpdateAction(dep)) {
        remediationButtons.push(`
        <button class="action-tab-btn primary update-btn" 
                data-package="${safePackageNameAttr}" 
                data-version="${safeLatestVersionAttr}"
                data-row-key="${safeRowKey}"
                data-workspace="${safeWorkspaceFolder}"
                data-package-root="${safePackageRoot}"
                type="button">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 17L17 7"/>
            <path d="M7 7h10v10"/>
          </svg>
          Update to ${safeLatestVersion}
        </button>
      `);
      }

      if (remediationButtons.length > 0) {
        sections.push(`
        <div>
          <h5 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Remediation</h5>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            ${remediationButtons.join('')}
          </div>
        </div>
      `);
      }

      const researchButtons = [
        `<button class="action-tab-btn" 
                type="button"
                data-action="open-link"
                data-url="https://www.npmjs.com/package/${safePackageNameAttr}"
                data-announce="Opening npm page for ${safePackageNameAttr}">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/>
            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/>
          </svg>
          View on npm
        </button>`,
      ];

      if (repoLink) {
        researchButtons.push(`
        <button class="action-tab-btn" 
                type="button"
                data-action="open-link"
                data-url="${escapeAttribute(repoLink)}"
                data-announce="Opening repository for ${safePackageNameAttr}">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M4 4a2 2 0 012-2h3.5a1 1 0 010 2H6v12h8V9.5a1 1 0 112 0V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/>
            <path d="M13 2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 11-2 0V3h-1a1 1 0 01-1-1z"/>
            <path d="M14 6a1 1 0 011-1h3a1 1 0 110 2h-2v8a1 1 0 11-2 0V6z"/>
          </svg>
          View Repository
        </button>
      `);
      }

      sections.push(`
      <div>
        <h5 class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Research</h5>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${researchButtons.join('')}
        </div>
      </div>
    `);

      return `
      <div class="space-y-5">
        ${sections.join('')}
      </div>
    `;
    }

    renderTransitiveTab(dep) {
      if (!window.transitiveEnabled || !dep.children || dep.children.length === 0) return '';

      const collectImpacted = (nodes, path = []) => {
        const impacted = [];
        for (const node of nodes) {
          const currentPath = [...path, node];
          const hasVulns = node.cveIds && node.cveIds.length > 0;
          const childImpacted = node.children ? collectImpacted(node.children, currentPath) : [];
          if (hasVulns) {
            impacted.push({ node, path: currentPath });
          }
          impacted.push(...childImpacted);
        }
        return impacted;
      };

      const impactedNodes = collectImpacted(dep.children);
      const countAll = (nodes) => {
        let total = 0;
        for (const node of nodes) {
          total += 1;
          if (node.children) {
            total += countAll(node.children);
          }
        }
        return total;
      };
      const totalTransitiveCount = countAll(dep.children);
      const impactedCount = impactedNodes.length;

      if (impactedNodes.length === 0) {
        return `
          <div class="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-sm text-gray-600 dark:text-gray-400">
            No impacted transitive dependencies. All downstream packages are safe.
          </div>
        `;
      }

      const renderCveLinks = (ids) => {
        if (!ids || ids.length === 0) return '';
        return `
          <div class="flex flex-wrap gap-2 mt-2">
            ${ids
              .slice(0, 5)
              .map(
                (id) => `
                <a href="${escapeAttribute(this.buildVulnerabilityLink(id))}"
                   target="_blank"
                   rel="noopener noreferrer"
                   class="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 hover:underline">
                  ${id} 🔗
                </a>
              `
              )
              .join('')}
            ${
              ids.length > 5
                ? `<span class="text-xs text-gray-500 dark:text-gray-400">+${ids.length - 5} more</span>`
                : ''
            }
          </div>
        `;
      };

      const cards = impactedNodes
        .map(({ node, path }) => {
          const pathLabel = path.map((p) => p.packageName).join(' › ');
          const severityChip = this.renderSeverityChip(node.severity || 'none');
          const vulnBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
            ${node.cveIds.length} Vulnerability${node.cveIds.length > 1 ? 'ies' : ''}
          </span>`;
          const safeNodePackageName = escapeHtml(node.packageName);
          const safeNodeCurrentVersion = escapeHtml(node.currentVersion);
          const safePathLabel = escapeHtml(pathLabel);

          return `
            <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-800">
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-gray-900 dark:text-gray-100">${safeNodePackageName}</span>
                    <span class="font-mono text-xs text-gray-500 dark:text-gray-400">${safeNodeCurrentVersion}</span>
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400 break-all">Path: ${safePathLabel}</div>
                </div>
                <div class="flex items-center gap-2">
                  ${severityChip}
                  ${vulnBadge}
                </div>
              </div>
              ${renderCveLinks(node.cveIds)}
            </div>
          `;
        })
        .join('');

      return `
        <div class="space-y-3">
          <div class="flex flex-wrap gap-2 items-center text-xs">
            <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700">
              <span class="text-xs font-semibold">${totalTransitiveCount}</span>
              <span class="text-[0.65rem] uppercase tracking-wide text-slate-600 dark:text-slate-300">Total transitive • all depths</span>
            </span>
            <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-100 border border-red-200 dark:border-red-800">
              <span class="text-xs font-semibold">${impactedCount}</span>
              <span class="text-[0.65rem] uppercase tracking-wide text-red-700 dark:text-red-100">Impacted transitive</span>
            </span>
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            Showing only impacted transitive dependencies (nodes with vulnerabilities).
          </p>
          <div class="space-y-2">
            ${cards}
          </div>
        </div>
      `;
    }

    hasTransitiveVulns(dep) {
      const dfs = (node) => {
        if (!node || !node.children) return false;
        for (const child of node.children) {
          if (child.cveIds && child.cveIds.length > 0) return true;
          if (dfs(child)) return true;
        }
        return false;
      };
      return dfs(dep);
    }

    countTransitiveVulns(dep) {
      const dfs = (node) => {
        if (!node || !node.children) return 0;
        let total = 0;
        for (const child of node.children) {
          total += child.cveIds ? child.cveIds.length : 0;
          total += dfs(child);
        }
        return total;
      };
      return dfs(dep);
    }

    renderAlternativesTab(dep) {
      return `
      <div class="tab-content hidden alternatives-panel" data-tab-content="alternatives" data-package="${escapeAttribute(dep.packageName)}">
        <div class="mb-2 flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
          <button
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-200 dark:bg-gray-700 text-[10px] text-gray-700 dark:text-gray-100 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors group relative"
            type="button"
            data-action="reset-llm-config"
            title="Reset all LLM API keys and models"
          >
            <span class="group-hover:hidden">↺</span>
            <span class="hidden group-hover:inline text-[9px] font-medium">Reset</span>
          </button>
          <span>AI-powered suggestions are experimental. Always review before adopting.</span>
        </div>
        <div class="alternatives-container space-y-3 text-sm text-gray-600 dark:text-gray-300">
          ${this.renderAlternativesPlaceholder()}
        </div>
      </div>
    `;
    }

    renderAlternativesPlaceholder() {
      return `
      <div class="flex items-start gap-3 text-gray-600 dark:text-gray-400">
        <span class="text-xl" aria-hidden="true">💡</span>
        <div>
          <p class="font-semibold text-gray-800 dark:text-gray-100">Fetch alternative packages</p>
          <p class="text-xs text-gray-500 dark:text-gray-400">AI will suggest npm alternatives once an LLM API key is configured.</p>
        </div>
      </div>
    `;
    }

    renderVulnerabilityDetails(dep) {
      return `
      <div class="border-l-4 border-red-500 pl-4">
        <h4 class="font-semibold text-red-600 dark:text-red-400 mb-2">Security Vulnerabilities</h4>
        <div class="space-y-3">
          ${dep.vulnerabilities
            .map(
              (vuln) => `
            <div class="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <a href="${escapeAttribute(this.buildVulnerabilityLink(vuln.id))}" 
                     target="_blank"
                     rel="noopener noreferrer"
                     class="font-mono text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
                    ${escapeHtml(vuln.id)} 🔗
                  </a>
                  ${this.renderSourceBadge(vuln.source)}
                </div>
                ${this.renderSeverityChip(vuln.severity)}
              </div>
              <div class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                <p>
                  <strong>CVSS Score:</strong> ${vuln.cvssScore != null ? (vuln.cvssVersion ? `${vuln.cvssScore.toFixed(1)} (v${vuln.cvssVersion})` : vuln.cvssScore.toFixed(1)) : 'N/A'}
                </p>
                ${
                  vuln.vectorString
                    ? `
                  <p class="font-mono text-xs break-all" title="CVSS Vector String">
                    <strong>Vector:</strong> ${escapeHtml(vuln.vectorString)}
                  </p>
                `
                    : ''
                }
              </div>
              <p class="text-sm text-gray-700 dark:text-gray-300 mt-2">
                <strong>Recommendation:</strong> Update to version ${escapeHtml(dep.latestVersion)} or later
              </p>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    `;
    }

    renderSourceBadge(source) {
      if (source === 'osv') {
        return '';
      }

      const configs = {
        osv: {
          bg: 'bg-purple-100 dark:bg-purple-900',
          text: 'text-purple-800 dark:text-purple-200',
          label: 'OSV.dev',
        },
        github: {
          bg: 'bg-gray-100 dark:bg-gray-700',
          text: 'text-gray-800 dark:text-gray-200',
          label: 'GitHub',
        },
      };

      const config = configs[source] || configs.github;
      return `
      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}">
        ${config.label}
      </span>
    `;
    }

    renderNoVulnerabilities() {
      return `
      <div class="border-l-4 border-green-500 pl-4">
        <h4 class="font-semibold text-green-600 dark:text-green-400 mb-2">No Known Vulnerabilities</h4>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          This package has no known security vulnerabilities.
        </p>
      </div>
    `;
    }

    renderPackageInfo(dep) {
      const maintenanceNotice = this.renderMaintenanceNotice(dep);

      return `
      <div class="border-l-4 border-blue-500 pl-4">
        <h4 class="font-semibold text-blue-600 dark:text-blue-400 mb-2">Package Information</h4>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span class="text-gray-600 dark:text-gray-400">Current Version:</span>
            <span class="font-mono ml-2 text-gray-900 dark:text-gray-100">${escapeHtml(dep.currentVersion)}</span>
          </div>
          <div>
            <span class="text-gray-600 dark:text-gray-400">Latest Version:</span>
            <span class="font-mono ml-2 text-gray-900 dark:text-gray-100">${escapeHtml(dep.latestVersion)}</span>
          </div>
          <div>
            <span class="text-gray-600 dark:text-gray-400">Freshness:</span>
            <span class="ml-2">${this.renderFreshnessChip(dep.freshness)}</span>
          </div>
          <div>
            <span class="text-gray-600 dark:text-gray-400">Last Updated:</span>
            <span class="ml-2 text-gray-900 dark:text-gray-100">${this.formatRelativeTime(dep.lastUpdated)}</span>
          </div>
        </div>
        ${maintenanceNotice}
      </div>
    `;
    }

    renderCompatibilityTab(dep) {
      const compat = dep.compatibility;
      if (!compat) {
        return `
        <div class="border-l-4 border-gray-400 dark:border-gray-600 pl-4">
          <h4 class="font-semibold text-gray-600 dark:text-gray-400 mb-2">Compatibility Analysis</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            No compatibility analysis available for this package.
          </p>
        </div>
      `;
      }

      if (compat.status === 'safe' && compat.issues.length === 0) {
        return `
        <div class="border-l-4 border-green-500 pl-4">
          <h4 class="font-semibold text-green-600 dark:text-green-400 mb-2">No Compatibility Issues</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            This package is safe to use with your current dependencies.
          </p>
        </div>
      `;
      }

      let html = '';

      if (compat.issues.length > 0) {
        const borderColor =
          compat.status === 'version-deprecated'
            ? 'border-red-500'
            : compat.status === 'breaking-changes'
              ? 'border-orange-500'
              : 'border-yellow-500';

        const textColor =
          compat.status === 'version-deprecated'
            ? 'text-red-600 dark:text-red-400'
            : compat.status === 'breaking-changes'
              ? 'text-orange-600 dark:text-orange-400'
              : 'text-yellow-600 dark:text-yellow-400';

        html += `
        <div class="border-l-4 ${borderColor} pl-4 mb-4">
          <h4 class="font-semibold ${textColor} mb-2">Compatibility Issues</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            ${compat.issues.length} issue${compat.issues.length > 1 ? 's' : ''} found that may affect compatibility.
          </p>
          <div class="space-y-3">
        `;

        compat.issues.forEach((issue) => {
          const issueBadgeColors = {
            'version-deprecated': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
            'breaking-change':
              'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
            'version-conflict':
              'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
          };
          const badgeColor =
            issueBadgeColors[issue.type] ||
            'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';

          html += `
            <div class="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="flex items-start gap-3 mb-2">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeColor}">
                  ${this.formatIssueType(issue.type)}
                </span>
              </div>
              <p class="text-sm text-gray-900 dark:text-gray-100 leading-relaxed mb-2">
                ${linkifyText(issue.message)}
              </p>
              ${
                issue.recommendation
                  ? `
                <div class="mt-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">
                  <p class="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                    <strong class="text-gray-900 dark:text-gray-100">Recommendation:</strong> ${linkifyText(issue.recommendation)}
                  </p>
                </div>
              `
                  : ''
              }
              ${
                issue.migrationGuide
                  ? `
                <div class="mt-2">
                  <a href="${escapeAttribute(issue.migrationGuide)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                    View migration guide
                  </a>
                </div>
              `
                  : ''
              }
            </div>
          `;
        });

        html += `
          </div>
        </div>
        `;
      }

      // Filter out upgrade warnings that duplicate information already shown in issues
      // A warning is considered a duplicate if:
      // 1. It has the same migration guide URL as an issue (most reliable check)
      // 2. It's a breaking change and there's already a breaking-change issue with similar content
      const uniqueUpgradeWarnings = compat.upgradeWarnings
        ? compat.upgradeWarnings.filter((warning) => {
            // Primary check: same migration guide URL = duplicate
            if (warning.migrationGuide) {
              const isDuplicate = compat.issues.some(
                (issue) => issue.migrationGuide === warning.migrationGuide
              );
              if (isDuplicate) {
                return false; // Filter out duplicate
              }
            }

            // Secondary check: if warning is about breaking changes and there's already
            // a breaking-change issue, check if they're about the same thing
            const breakingChangeIssues = compat.issues.filter(
              (issue) => issue.type === 'breaking-change'
            );
            if (breakingChangeIssues.length > 0) {
              // If warning has no migration guide but issues do, it might be a duplicate
              // Only filter if the warning text is very similar to an issue message
              const warningText = (warning.breakingChange || warning.description || '')
                .trim()
                .toLowerCase();
              if (warningText.length > 0) {
                const isDuplicate = breakingChangeIssues.some((issue) => {
                  const issueText = (issue.message || '').trim().toLowerCase();
                  // Only consider duplicate if texts are very similar (one contains the other substantially)
                  // Require at least 20 characters overlap to avoid false positives
                  return (
                    issueText.length >= 20 &&
                    warningText.length >= 20 &&
                    (issueText.includes(warningText) || warningText.includes(issueText))
                  );
                });
                if (isDuplicate) {
                  return false; // Filter out duplicate
                }
              }
            }

            return true; // Keep this warning
          })
        : [];

      if (uniqueUpgradeWarnings.length > 0) {
        html += `
        <div class="border-l-4 border-yellow-500 pl-4">
          <h4 class="font-semibold text-yellow-600 dark:text-yellow-400 mb-2">Upgrade Warnings</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Updating <strong class="text-gray-900 dark:text-gray-100">${escapeHtml(dep.packageName)}</strong> to <strong class="text-gray-900 dark:text-gray-100">${escapeHtml(dep.latestVersion)}</strong> may cause breaking changes:
          </p>
          <div class="space-y-3">
        `;

        uniqueUpgradeWarnings.forEach((warning) => {
          html += `
            <div class="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
              <div class="flex items-start gap-2 mb-2">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                  Breaking Change
                </span>
              </div>
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                ${escapeHtml(warning.breakingChange)}
              </p>
              <p class="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                ${escapeHtml(warning.description)}
              </p>
              ${
                warning.migrationGuide
                  ? `
                <div class="mt-2">
                  <a href="${escapeAttribute(warning.migrationGuide)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                    </svg>
                    View migration guide
                  </a>
                </div>
              `
                  : ''
              }
            </div>
          `;
        });

        html += `
          </div>
        </div>
        `;
      }

      return (
        html ||
        `
        <div class="border-l-4 border-green-500 pl-4">
          <h4 class="font-semibold text-green-600 dark:text-green-400 mb-2">No Compatibility Issues</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            This package is safe to use with your current dependencies.
          </p>
        </div>
      `
      );
    }

    formatIssueType(type) {
      const types = {
        'version-deprecated': 'Version Deprecated',
        'breaking-change': 'Breaking Change',
        'version-conflict': 'Version Conflict',
      };
      return types[type] || type;
    }

    /**
     * Builds npm package page URL
     */
    buildNpmPackageUrl(packageName) {
      if (!packageName) return null;
      // Handle scoped packages (@scope/package)
      const encodedName = encodeURIComponent(packageName);
      return `https://www.npmjs.com/package/${encodedName}`;
    }

    /**
     * Builds candidate license URLs (without validation)
     * Returns array of {url, label, priority} objects
     * Note: Homepage links are excluded as requested
     */
    buildLicenseUrlCandidates(license, repositoryUrl, packageName) {
      const candidates = [];

      if (!license || !license.license) {
        return candidates;
      }

      const licenseStr = license.license.trim();

      // Priority 1: SPDX license page (most reliable)
      if (license.spdxId && license.spdxId !== 'Unknown') {
        candidates.push({
          url: `https://spdx.org/licenses/${license.spdxId}.html`,
          label: `SPDX License: ${license.spdxId}`,
          priority: 1,
          needsValidation: false, // SPDX links are reliable
        });
      }

      // Priority 2: npm package page (always reliable, shows license info)
      if (packageName) {
        candidates.push({
          url: this.buildNpmPackageUrl(packageName),
          label: 'npm Package Page',
          priority: 2,
          needsValidation: false, // npm links are always reliable
        });
      }

      // Priority 3: Repository license file (only if explicitly mentioned in license string)
      // Only add if repository URL is available, looks valid, AND license string explicitly references a file
      if (repositoryUrl && this.isValidRepositoryUrl(repositoryUrl)) {
        // Normalize repository URL to handle git+https://, git+ssh://, etc.
        const normalizeFn =
          typeof window.normalizeRepositoryUrl === 'function'
            ? window.normalizeRepositoryUrl
            : (url) => {
                if (!url) return '';
                // Fallback normalization if window.normalizeRepositoryUrl is not available
                let cleanUrl = url.replace(/^git\+/, '');
                cleanUrl = cleanUrl.replace(/\.git$/, '');
                cleanUrl = cleanUrl.replace(/^ssh:\/\/git@/, 'https://');
                cleanUrl = cleanUrl.replace(/^git@([^:]+):/, 'https://$1/');
                return cleanUrl;
              };
        const normalizedRepoUrl = normalizeFn(repositoryUrl);
        // Ensure baseUrl doesn't have trailing slash
        const baseUrl = normalizedRepoUrl.replace(/\/$/, '');
        // For GitHub/GitLab, we trust the repository URL structure (already validated)
        // Only show license file links if explicitly mentioned in the license string
        const isTrustedHost = baseUrl.includes('github.com') || baseUrl.includes('gitlab.com');
        if (isTrustedHost && baseUrl && licenseStr.toUpperCase().includes('SEE LICENSE IN')) {
          const match = licenseStr.match(/SEE LICENSE IN\s+(.+)/i);
          if (match) {
            const fileName = match[1].trim().replace(/^\.\//, '').replace(/[<>"]/g, ''); // Remove any HTML-like tags or quotes
            // Only add if we have a valid file name
            if (fileName && fileName.length > 0) {
              candidates.push({
                url: `${baseUrl}/blob/HEAD/${fileName}`,
                label: `License File: ${fileName}`,
                priority: 3,
                needsValidation: false, // Trust GitHub/GitLab URLs since repo URL is already validated
              });
            }
          }
        }
      }

      // Deduplicate by URL to avoid showing the same link twice
      const seenUrls = new Set();
      const uniqueCandidates = candidates.filter((candidate) => {
        if (seenUrls.has(candidate.url)) {
          return false;
        }
        seenUrls.add(candidate.url);
        return true;
      });

      return uniqueCandidates.sort((a, b) => a.priority - b.priority);
    }

    /**
     * Checks if a repository URL looks valid (not empty, has proper format)
     */
    isValidRepositoryUrl(repositoryUrl) {
      if (!repositoryUrl || typeof repositoryUrl !== 'string') {
        return false;
      }

      const trimmed = repositoryUrl.trim();
      if (trimmed.length === 0) {
        return false;
      }

      // Check if it's a valid URL format
      try {
        const url = new URL(trimmed.replace(/\.git$/, ''));
        // Only accept GitHub, GitLab, or similar open source hosting
        const validHosts = ['github.com', 'gitlab.com', 'bitbucket.org', 'sourceforge.net'];
        return validHosts.some((host) => url.hostname.includes(host));
      } catch {
        return false;
      }
    }

    /**
     * Validates a URL structure (without fetching, to avoid CSP violations)
     * Returns true if URL structure looks valid
     * Note: We don't fetch URLs due to Content Security Policy restrictions in webviews
     */
    validateLicenseUrl(url) {
      if (!url) return false;

      try {
        // For GitHub/GitLab, validate URL structure without fetching
        if (url.includes('github.com') || url.includes('gitlab.com')) {
          const urlObj = new URL(url);
          const pathParts = urlObj.pathname.split('/').filter(Boolean);
          // GitHub/GitLab URLs should have at least owner/repo structure
          if (pathParts.length >= 2) {
            return true; // Assume valid if structure is correct
          }
        }
        // For other URLs, check if they're valid URL format
        new URL(url);
        return true;
      } catch {
        return false;
      }
    }

    renderLicenseTab(dep) {
      const license = dep.license;
      if (!license) {
        return `
        <div class="border-l-4 border-gray-400 dark:border-gray-600 pl-4">
          <h4 class="font-semibold text-gray-600 dark:text-gray-400 mb-2">License Information</h4>
          <p class="text-sm text-gray-600 dark:text-gray-400">
            No license information available for this package.
          </p>
        </div>
      `;
      }

      const borderColor = license.isCompatible
        ? 'border-green-500'
        : license.licenseType === 'proprietary'
          ? 'border-red-500'
          : license.licenseType === 'copyleft'
            ? 'border-orange-500'
            : 'border-yellow-500';

      const textColor = license.isCompatible
        ? 'text-green-600 dark:text-green-400'
        : license.licenseType === 'proprietary'
          ? 'text-red-600 dark:text-red-400'
          : license.licenseType === 'copyleft'
            ? 'text-orange-600 dark:text-orange-400'
            : 'text-yellow-600 dark:text-yellow-400';

      const statusBadge = license.isCompatible
        ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200 ring-1 ring-green-200/60 dark:ring-green-800/80">✓ Compatible</span>'
        : '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200 ring-1 ring-red-200/60 dark:ring-red-800/80">✗ Incompatible</span>';

      const typeBadgeColors = {
        permissive: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
        copyleft: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
        proprietary: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        unknown: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
      };
      const typeBadgeColor = typeBadgeColors[license.licenseType] || typeBadgeColors.unknown;

      const riskBadgeColors = {
        low: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
        medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
        high: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      };
      const riskBadge = license.riskLevel
        ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${riskBadgeColors[license.riskLevel] || riskBadgeColors.medium}">
            Risk: ${license.riskLevel.charAt(0).toUpperCase() + license.riskLevel.slice(1)}
          </span>`
        : '';

      const html = `
        <div class="border-l-4 ${borderColor} pl-4 mb-4">
          <div class="flex items-center gap-3 mb-3">
            <h4 class="font-semibold ${textColor} mb-0">License Information</h4>
            ${statusBadge}
          </div>

          <div class="space-y-4">
            <!-- License Details -->
            <div class="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span class="text-gray-600 dark:text-gray-400 font-medium">License Expression:</span>
                  <p class="font-mono text-gray-900 dark:text-gray-100 mt-1 break-all">${escapeHtml(license.license || 'Unknown')}</p>
                </div>
                ${
                  license.spdxId
                    ? `<div>
                        <span class="text-gray-600 dark:text-gray-400 font-medium">SPDX ID:</span>
                        <p class="font-mono text-gray-900 dark:text-gray-100 mt-1">${escapeHtml(license.spdxId)}</p>
                      </div>`
                    : ''
                }
                <div>
                  <span class="text-gray-600 dark:text-gray-400 font-medium">License Type:</span>
                  <p class="mt-1">
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeBadgeColor}">
                      ${escapeHtml(license.licenseType ? license.licenseType.charAt(0).toUpperCase() + license.licenseType.slice(1) : 'Unknown')}
                    </span>
                  </p>
                </div>
                ${
                  license.riskLevel
                    ? `<div>
                        <span class="text-gray-600 dark:text-gray-400 font-medium">Risk Level:</span>
                        <p class="mt-1">${riskBadge}</p>
                      </div>`
                    : ''
                }
              </div>
            </div>

            <!-- Compatibility Status -->
            ${
              license.compatibilityReason
                ? `<div class="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
                    <h5 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Compatibility Assessment</h5>
                    <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">${escapeHtml(license.compatibilityReason)}</p>
                  </div>`
                : ''
            }

            <!-- License Requirements -->
            <div class="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
              <h5 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">License Requirements</h5>
              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <span class="text-sm text-gray-600 dark:text-gray-400">Requires Attribution:</span>
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    license.requiresAttribution
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }">
                    ${license.requiresAttribution ? 'Yes' : 'No'}
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-sm text-gray-600 dark:text-gray-400">Requires Source Code:</span>
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    license.requiresSourceCode
                      ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
                  }">
                    ${license.requiresSourceCode ? 'Yes (Copyleft)' : 'No'}
                  </span>
                </div>
              </div>
            </div>

            <!-- Conflicts -->
            ${
              license.conflictsWith && license.conflictsWith.length > 0
                ? `<div class="bg-red-50 dark:bg-red-900/20 p-4 rounded border border-red-200 dark:border-red-800">
                    <h5 class="text-sm font-semibold text-red-900 dark:text-red-100 mb-2">⚠️ License Conflicts</h5>
                    <p class="text-sm text-red-700 dark:text-red-300 mb-2">
                      This license may conflict with:
                    </p>
                    <ul class="list-disc list-inside text-sm text-red-700 dark:text-red-300 space-y-1">
                      ${license.conflictsWith.map((conflict) => `<li>${escapeHtml(conflict)}</li>`).join('')}
                    </ul>
                  </div>`
                : ''
            }

            <!-- SPDX IDs (if multiple) -->
            ${
              license.spdxIds && license.spdxIds.length > 1
                ? `<div class="bg-white dark:bg-gray-800 p-4 rounded border border-gray-200 dark:border-gray-700">
                    <h5 class="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">All SPDX Identifiers</h5>
                    <div class="flex flex-wrap gap-2">
                      ${license.spdxIds
                        .map(
                          (id) =>
                            `<span class="inline-flex items-center px-2 py-1 rounded text-xs font-mono bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">${escapeHtml(id)}</span>`
                        )
                        .join('')}
                    </div>
                  </div>`
                : ''
            }

            <!-- License Links -->
            ${(() => {
              // Build candidates (homepage removed, repository validated)
              const candidates = this.buildLicenseUrlCandidates(
                license,
                dep.repositoryUrl,
                dep.packageName
              );

              if (candidates.length === 0) {
                return '';
              }

              // Separate links that need validation from those that don't
              const validatedLinks = candidates.filter((link) => !link.needsValidation);
              const linksNeedingValidation = candidates.filter((link) => link.needsValidation);

              // Show validated links immediately (npm, SPDX)
              let linksHtml = '';

              validatedLinks.forEach((link) => {
                const isNpm = link.label === 'npm Package Page';
                linksHtml += `
                    <a href="${escapeAttribute(link.url)}" 
                       target="_blank" 
                       rel="noopener noreferrer"
                       class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                      </svg>
                      ${escapeHtml(isNpm ? 'View on npm' : link.label)}
                    </a>`;
              });

              // Add placeholder for links that need validation (will be validated async)
              // Use rowKey for uniqueness instead of packageName to avoid collisions
              const rowKey = dep.rowKey || dep.packageName || 'unknown';
              const validationPlaceholderId = `license-links-${String(rowKey).replace(/[^a-zA-Z0-9]/g, '-')}`;
              if (linksNeedingValidation.length > 0) {
                linksHtml += `<div id="${validationPlaceholderId}" class="license-links-validation-placeholder"></div>`;
              }

              // Validate repository links asynchronously
              if (linksNeedingValidation.length > 0) {
                // Use setTimeout to avoid blocking rendering
                setTimeout(async () => {
                  // Check if the tab is still visible (row hasn't been re-rendered)
                  const placeholder = document.getElementById(validationPlaceholderId);
                  if (!placeholder) {
                    // Placeholder was removed (tab closed or re-rendered), skip validation
                    return;
                  }

                  const validatedRepoLinks = [];
                  for (const link of linksNeedingValidation) {
                    const isValid = await this.validateLicenseUrl(link.url);
                    if (isValid) {
                      validatedRepoLinks.push(link);
                    }
                  }

                  // Double-check placeholder still exists (might have been removed during validation)
                  const updatedPlaceholder = document.getElementById(validationPlaceholderId);
                  if (updatedPlaceholder && validatedRepoLinks.length > 0) {
                    let repoLinksHtml = '';
                    validatedRepoLinks.forEach((link) => {
                      repoLinksHtml += `
                        <a href="${escapeAttribute(link.url)}" 
                           target="_blank" 
                           rel="noopener noreferrer"
                           class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/60 transition-colors">
                          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                          </svg>
                          ${escapeHtml(link.label)}
                        </a>`;
                    });
                    updatedPlaceholder.outerHTML = repoLinksHtml;
                  } else if (updatedPlaceholder) {
                    // Remove placeholder if no valid links found
                    updatedPlaceholder.remove();
                  }
                }, 0);
              }

              if (linksHtml.trim() === '') {
                return '';
              }

              return `<div class="bg-blue-50 dark:bg-blue-900/20 p-4 rounded border border-blue-200 dark:border-blue-800">
                  <h5 class="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">🔗 License Links</h5>
                  <p class="text-sm text-blue-800 dark:text-blue-200 mb-3">
                    ${!license.isCompatible ? 'Review the license terms to verify compatibility:' : 'View license information:'}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    ${linksHtml}
                  </div>
                </div>`;
            })()}
          </div>
        </div>
      `;

      return html;
    }

    renderMaintenanceNotice(dep) {
      const signals = dep.maintenanceSignals;
      if (!signals || !signals.isLongTermUnmaintained || !signals.reasons?.length) {
        return '';
      }

      const badges = signals.reasons
        .map(
          (reason) => `
          <div class="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-700">
            <p class="text-xs font-semibold uppercase tracking-wide text-yellow-700 dark:text-yellow-300 mb-1">${escapeAttribute(reason.label)}</p>
            ${
              reason.details
                ? `<p class="text-xs text-gray-700 dark:text-gray-300">${escapeAttribute(reason.details)}</p>`
                : ''
            }
          </div>
        `
        )
        .join('');

      return `
      <div class="mt-4">
        <div class="flex items-center gap-2 text-yellow-700 dark:text-yellow-300 mb-2">
          <span class="text-lg" aria-hidden="true">⚠️</span>
          <span class="text-sm font-semibold">Long-term maintenance concerns detected</span>
        </div>
        <div class="grid gap-2 md:grid-cols-2">
          ${badges}
        </div>
      </div>
    `;
    }

    getSeverityBorderColor(severity) {
      const colors = {
        critical: 'border-red-500',
        high: 'border-orange-500',
        medium: 'border-yellow-500',
        low: 'border-yellow-400',
        none: 'border-green-500',
      };
      return colors[severity] || 'border-gray-300';
    }

    getSeverityBorderClass(severity) {
      const severityMap = {
        Critical: 'status-border-critical',
        High: 'status-border-high',
        Medium: 'status-border-medium',
        Low: 'status-border-low',
        None: 'status-border-none',
      };
      return severityMap[severity] || 'status-border-none';
    }

    getSeverityDotClass(severity) {
      const dots = {
        critical: 'bg-red-500',
        high: 'bg-orange-500',
        medium: 'bg-amber-500',
        low: 'bg-emerald-500',
        none: 'bg-emerald-500',
      };
      return dots[severity] || 'bg-emerald-500';
    }

    buildVulnerabilityLink(id) {
      const trimmed = (id || '').trim();
      const isCve = /^CVE-\d{4}-\d{4,}$/i.test(trimmed);
      const isGhsa = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(trimmed);

      if (isCve) {
        return `https://nvd.nist.gov/vuln/detail/${trimmed.toUpperCase()}`;
      }

      if (isGhsa) {
        return `https://github.com/advisories/${trimmed.toLowerCase()}`;
      }

      // Fallback to OSV for any other identifier shapes
      return `https://osv.dev/vulnerability/${encodeURIComponent(trimmed)}`;
    }

    renderCVELinks(dep) {
      const cveIds = dep.cveIds || [];
      if (cveIds.length === 0) {
        return `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-200 ring-emerald-200/60 dark:ring-emerald-800/80">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          None
        </span>
      `;
      }

      const rowKey = dep.rowKey || dep.packageName;
      const isExpanded = this.expandedCVERows.has(rowKey);
      const maxVisible = isExpanded ? cveIds.length : 2;
      const visible = cveIds.slice(0, maxVisible);
      const remaining = cveIds.length - maxVisible;

      const chips = visible
        .map(
          (cveId) => `
        <a href="${this.buildVulnerabilityLink(cveId)}" 
           target="_blank"
           rel="noopener noreferrer"
           class="cve-chip"
           title="Open details for ${cveId}">
          ${cveId}
          <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12.293 2.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414L9.414 16H6v-3.414l8.293-8.293z"></path>
          </svg>
        </a>
      `
        )
        .join('');

      const toggleButton =
        cveIds.length > 2
          ? `<button type="button" class="cve-toggle-btn" data-action="toggle-cves" data-package="${dep.packageName}" data-row-key="${rowKey}">
            ${isExpanded ? 'Show less' : `+${remaining} more`}
          </button>`
          : '';

      return `<div class="flex flex-wrap gap-2 items-center">${chips}${toggleButton}</div>`;
    }

    renderSeverityChip(severity) {
      const configs = {
        critical: {
          bg: 'bg-red-50 dark:bg-red-900/30',
          text: 'text-red-700 dark:text-red-200',
          ring: 'ring-red-200/60 dark:ring-red-800/80',
          dot: 'bg-red-500',
          label: 'Critical',
          extraClass: '',
        },
        high: {
          bg: 'bg-orange-50 dark:bg-orange-900/30',
          text: 'text-orange-700 dark:text-orange-200',
          ring: 'ring-orange-200/60 dark:ring-orange-800/80',
          dot: 'bg-orange-400',
          label: 'High',
          extraClass: '',
        },
        medium: {
          bg: 'bg-amber-50 dark:bg-amber-900/30',
          text: 'text-amber-700 dark:text-amber-200',
          ring: 'ring-amber-200/60 dark:ring-amber-800/80',
          dot: 'bg-amber-400',
          label: 'Medium',
          extraClass: '',
        },
        low: {
          bg: 'bg-emerald-50 dark:bg-emerald-900/30',
          text: 'text-emerald-700 dark:text-emerald-200',
          ring: 'ring-emerald-200/60 dark:ring-emerald-800/80',
          dot: 'bg-emerald-400',
          label: 'Low',
          extraClass: '',
        },
        none: {
          bg: 'bg-emerald-50 dark:bg-emerald-900/30',
          text: 'text-emerald-700 dark:text-emerald-200',
          ring: 'ring-emerald-200/60 dark:ring-emerald-800/80',
          dot: 'bg-emerald-500',
          label: 'None',
          extraClass: '',
        },
      };

      const config = configs[severity] || configs.none;
      return `
      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${config.bg} ${config.text} ${config.ring} ${config.extraClass}">
        <span class="w-1.5 h-1.5 rounded-full ${config.dot}"></span>
        ${config.label}
      </span>
    `;
    }

    renderFreshnessChip(freshness) {
      const configs = {
        current: {
          bg: 'bg-emerald-50 dark:bg-emerald-900/30',
          text: 'text-emerald-700 dark:text-emerald-200',
          ring: 'ring-emerald-200/60 dark:ring-emerald-800/80',
          label: 'Current',
        },
        patch: {
          bg: 'bg-lime-50 dark:bg-lime-900/30',
          text: 'text-lime-700 dark:text-lime-200',
          ring: 'ring-lime-200/60 dark:ring-lime-800/80',
          label: 'Patch',
        },
        minor: {
          bg: 'bg-amber-50 dark:bg-amber-900/30',
          text: 'text-amber-700 dark:text-amber-200',
          ring: 'ring-amber-200/60 dark:ring-amber-800/80',
          label: 'Minor',
        },
        major: {
          bg: 'bg-orange-50 dark:bg-orange-900/30',
          text: 'text-orange-700 dark:text-orange-200',
          ring: 'ring-orange-200/60 dark:ring-orange-800/80',
          label: 'Major',
        },
        unmaintained: {
          bg: 'bg-red-50 dark:bg-red-900/30',
          text: 'text-red-700 dark:text-red-200',
          ring: 'ring-red-200/60 dark:ring-red-800/80',
          label: 'Unmaintained',
        },
      };

      const config = configs[freshness] || configs.current;
      return `
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ring-1 ring-inset ${config.bg} ${config.text} ${config.ring}">
        ${config.label}
      </span>
    `;
    }

    renderCompatibilityChip(compatibility) {
      if (!compatibility) {
        return '<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-50 dark:bg-gray-900/30 text-gray-600 dark:text-gray-400 ring-1 ring-gray-200/60 dark:ring-gray-800/80" title="Compatibility analysis not available (may need to re-scan)">Not Analyzed</span>';
      }

      const configs = {
        safe: {
          bg: 'bg-green-50 dark:bg-green-900/30',
          text: 'text-green-700 dark:text-green-200',
          ring: 'ring-green-200/60 dark:ring-green-800/80',
          label: '✓ Safe',
        },
        'breaking-changes': {
          bg: 'bg-orange-50 dark:bg-orange-900/30',
          text: 'text-orange-700 dark:text-orange-200',
          ring: 'ring-orange-200/60 dark:ring-orange-800/80',
          label: '⚠ Breaking',
        },
        'version-deprecated': {
          bg: 'bg-red-50 dark:bg-red-900/30',
          text: 'text-red-700 dark:text-red-200',
          ring: 'ring-red-200/60 dark:ring-red-800/80',
          label: '✗ Deprecated',
        },
        unknown: {
          bg: 'bg-gray-50 dark:bg-gray-900/30',
          text: 'text-gray-700 dark:text-gray-200',
          ring: 'ring-gray-200/60 dark:ring-gray-800/80',
          label: 'Unknown',
        },
      };

      const config = configs[compatibility.status] || configs.unknown;
      return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text} ring-1 ${config.ring}">${config.label}</span>`;
    }

    renderUpdateButton(dep) {
      return `
      <button class="update-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-blue-600/10 text-blue-600 dark:text-blue-300 hover:bg-blue-600/20 transition-colors" 
              data-package="${dep.packageName}" 
              data-version="${dep.latestVersion}"
              title="Update to ${dep.latestVersion}">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v6h6M20 20v-6h-6M5 19a9 9 0 0114-7.5M19 5a9 9 0 01-14 7.5"/>
        </svg>
        Update
      </button>
    `;
    }

    formatRelativeTime(date) {
      const now = new Date();
      const then = new Date(date);
      const diffMs = now - then;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Yesterday';
      if (diffDays < 30) return `${diffDays} days ago`;
      if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
      return `${Math.floor(diffDays / 365)} years ago`;
    }

    getPaginatedData() {
      const start = (this.currentPage - 1) * this.rowsPerPage;
      const end = start + this.rowsPerPage;
      return this.filteredDependencies.slice(start, end);
    }

    renderPagination() {
      const totalPages = Math.ceil(this.filteredDependencies.length / this.rowsPerPage);
      const start = (this.currentPage - 1) * this.rowsPerPage + 1;
      const end = Math.min(this.currentPage * this.rowsPerPage, this.filteredDependencies.length);

      const pageIndicator = document.getElementById('page-indicator');
      const paginationInfo = document.getElementById('pagination-info');
      const prevBtn = document.getElementById('prev-page-btn');
      const nextBtn = document.getElementById('next-page-btn');

      if (pageIndicator) {
        pageIndicator.textContent = `Page ${this.currentPage} of ${totalPages || 1}`;
      }

      if (paginationInfo) {
        paginationInfo.textContent = `Showing ${start}-${end} of ${this.filteredDependencies.length} dependencies`;
      }

      if (prevBtn) {
        prevBtn.disabled = this.currentPage === 1;
      }

      if (nextBtn) {
        nextBtn.disabled = this.currentPage >= totalPages;
      }
    }

    updateHeaderCheckboxState() {
      const checkbox = document.getElementById('select-all');
      if (!checkbox) return;

      const total = this.filteredDependencies.length;
      if (total === 0) {
        checkbox.checked = false;
        checkbox.indeterminate = false;
        return;
      }

      let selected = 0;
      for (const dep of this.filteredDependencies) {
        const key = dep.rowKey || dep.packageName;
        if (this.selectedRows.has(key)) {
          selected++;
        }
      }

      checkbox.checked = selected === total;
      checkbox.indeterminate = selected > 0 && selected < total;
    }

    nextPage() {
      const totalPages = Math.ceil(this.filteredDependencies.length / this.rowsPerPage);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.render();
      }
    }

    prevPage() {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.render();
      }
    }

    toggleRowSelection(rowKey) {
      Logger.log('[TableManager] toggleRowSelection called for:', rowKey);
      const wasSelected = this.selectedRows.has(rowKey);
      if (wasSelected) {
        this.selectedRows.delete(rowKey);
        Logger.log('[TableManager] Deselected:', rowKey);
      } else {
        this.selectedRows.add(rowKey);
        Logger.log('[TableManager] Selected:', rowKey);
      }
      Logger.log('[TableManager] Total selected:', this.selectedRows.size);
      this.updateBulkUpdateButton();
      this.render();
    }

    updateBulkUpdateButton() {
      const container = document.getElementById('bulk-update-container');
      const totalEl = document.getElementById('selected-total');
      const totalLabelEl = document.getElementById('selected-total-label');
      const countEl = document.getElementById('selected-count');
      const countLabelEl = document.getElementById('selected-count-label');

      if (!container || !totalEl || !countEl) {
        return;
      }

      // No packages selected - hide button
      if (this.selectedRows.size === 0) {
        container.classList.add('hidden');
        container.setAttribute('hidden', 'true');
        return;
      }

      // Ensure container becomes visible when selections exist
      container.classList.remove('hidden');
      container.removeAttribute('hidden');

      // Get selected dependencies from allDependencies (not just filtered)
      const selectedDeps = this.allDependencies.filter((dep) => {
        const key = dep.rowKey || dep.packageName;
        return this.selectedRows.has(key);
      });

      // Count outdated packages - explicitly check for hasUpdate being true
      // hasUpdate can be true, false, or undefined, so we need to be explicit
      const outdatedDeps = selectedDeps.filter((dep) => {
        // Check if package has an update available
        // hasUpdate should be boolean true if outdated, false or undefined if up-to-date
        // Also check version mismatch as fallback
        const hasUpdateFlag = dep.hasUpdate === true;
        const versionMismatch =
          dep.latestVersion && dep.currentVersion && dep.latestVersion !== dep.currentVersion;
        return hasUpdateFlag || versionMismatch;
      });
      const outdatedCount = outdatedDeps.length;
      const totalSelected = selectedDeps.length;

      // Check if all filtered dependencies are selected (root checkbox scenario)
      // This happens when user clicks the root checkbox
      const allFilteredSelected =
        totalSelected === this.filteredDependencies.length &&
        this.filteredDependencies.length > 0 &&
        totalSelected > 0;

      // Debug logging (can be removed in production)
      Logger.log('[BulkUpdate] Selection state:', {
        totalSelected,
        outdatedCount,
        allFilteredSelected,
        filteredDepsCount: this.filteredDependencies.length,
        selectedPackages: Array.from(this.selectedRows).slice(0, 5), // Show first 5 for brevity
        outdatedPackages: outdatedDeps.slice(0, 5).map((d) => ({
          name: d.packageName,
          hasUpdate: d.hasUpdate,
          current: d.currentVersion,
          latest: d.latestVersion,
        })),
      });

      let shouldShow = false;

      if (allFilteredSelected) {
        // Root checkbox scenario: show if at least one selected package is outdated
        shouldShow = outdatedCount > 0;
        Logger.log('[BulkUpdate] Root checkbox scenario:', {
          shouldShow,
          outdatedCount,
          totalSelected,
        });
      } else {
        // Individual selection scenario: show if 2+ packages selected AND at least 2 are outdated
        if (totalSelected >= 2) {
          // At least 2 packages must be outdated (not all need to be outdated)
          shouldShow = outdatedCount >= 2;
          Logger.log('[BulkUpdate] Individual selection scenario:', {
            shouldShow,
            totalSelected,
            outdatedCount,
            condition: `totalSelected (${totalSelected}) >= 2 && outdatedCount (${outdatedCount}) >= 2`,
          });
        } else {
          // Only one package selected - don't show bulk update
          shouldShow = false;
          Logger.log('[BulkUpdate] Only one package selected, hiding button:', { totalSelected });
        }
      }

      if (shouldShow) {
        container.classList.remove('hidden');

        // Update total selected count
        totalEl.textContent = totalSelected;
        if (totalLabelEl) {
          totalLabelEl.textContent = totalSelected === 1 ? 'package' : 'packages';
        }

        // Update outdated count
        countEl.textContent = outdatedCount;
        if (countLabelEl) {
          countLabelEl.textContent = outdatedCount === 1 ? 'needs update' : 'need updates';
        }
        Logger.log('[BulkUpdate] Button shown:', { totalSelected, outdatedCount });
      } else {
        container.classList.add('hidden');
        Logger.log('[BulkUpdate] Button hidden');
      }
    }

    sortBy(column) {
      // Toggle sort direction if same column, otherwise default to ascending
      if (this.sortColumn === column) {
        this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        this.sortColumn = column;
        this.sortDirection = 'asc';
      }

      // Sort the filtered dependencies
      this.filteredDependencies.sort((a, b) => this.compareRows(a, b, column));

      // Update sort indicators in headers
      this.updateSortIndicators();

      // Re-render table
      this.render();
    }

    compareRows(a, b, column) {
      let aValue, bValue;

      switch (column) {
        case 'packageName':
          aValue = a.packageName.toLowerCase();
          bValue = b.packageName.toLowerCase();
          break;

        case 'severity': {
          // Sort by severity priority: critical > high > medium > low > none
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };
          aValue = severityOrder[a.severity];
          bValue = severityOrder[b.severity];
          break;
        }

        case 'cvssScore':
          aValue = a.cvssScore !== null ? a.cvssScore : -1;
          bValue = b.cvssScore !== null ? b.cvssScore : -1;
          break;

        case 'lastUpdated':
          aValue = new Date(a.lastUpdated).getTime();
          bValue = new Date(b.lastUpdated).getTime();
          break;

        default:
          return 0;
      }

      // Apply sort direction
      if (this.sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    }

    updateSortIndicators() {
      // Reset all indicators to neutral
      document.querySelectorAll('[data-sort] .sort-indicator').forEach((indicator) => {
        indicator.innerHTML = this.getSortIcon('neutral');
        indicator.classList.remove('asc', 'desc', 'active');
      });

      if (!this.sortColumn) return;

      const indicator = document.querySelector(`[data-sort="${this.sortColumn}"] .sort-indicator`);
      if (indicator) {
        const direction = this.sortDirection === 'desc' ? 'desc' : 'asc';
        indicator.innerHTML = this.getSortIcon(direction);
        indicator.classList.add(direction, 'active');
      }
    }

    toggleRowExpansion(rowKey) {
      if (this.expandedRow === rowKey) {
        // Collapse if already expanded
        this.expandedRow = null;
      } else {
        // Expand this row (and collapse any other)
        this.expandedRow = rowKey;
      }
      this.render();
    }

    toggleCVEExpansion(rowKey) {
      if (this.expandedCVERows.has(rowKey)) {
        this.expandedCVERows.delete(rowKey);
      } else {
        this.expandedCVERows.add(rowKey);
      }
      this.render();
    }

    showVulnerabilities(rowKey, packageName) {
      const focusVulnTab = () => {
        if (typeof window.switchExpandedTab === 'function') {
          window.switchExpandedTab(null, rowKey, 'vulnerabilities', packageName || rowKey);
        }
      };

      if (this.expandedRow !== rowKey) {
        this.expandedRow = rowKey;
        this.render();
        requestAnimationFrame(() => focusVulnTab());
      } else {
        focusVulnTab();
      }
    }

    showTransitiveDependencies(rowKey, packageName) {
      const focusTransitiveTab = () => {
        if (typeof window.switchExpandedTab === 'function') {
          window.switchExpandedTab(null, rowKey, 'transitive', packageName || rowKey);
        }
      };

      if (this.expandedRow !== rowKey) {
        this.expandedRow = rowKey;
        this.render();
        requestAnimationFrame(() => focusTransitiveTab());
      } else {
        focusTransitiveTab();
      }
    }

    navigateToPackageTransitive(rowKey, packageName) {
      const idx = this.filteredDependencies.findIndex(
        (dep) => (dep.rowKey || dep.packageName) === rowKey
      );
      if (idx === -1) return;

      const targetPage = Math.floor(idx / this.rowsPerPage) + 1;
      if (this.currentPage !== targetPage) {
        this.currentPage = targetPage;
      }

      this.expandedRow = rowKey;
      this.render();

      requestAnimationFrame(() => {
        if (typeof window.switchExpandedTab === 'function') {
          window.switchExpandedTab(null, rowKey, 'transitive', packageName || rowKey);
        }
        const rowEl = document.querySelector(`tr[data-row-key="${CSS.escape(rowKey)}"]`);
        if (rowEl) {
          rowEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    selectAll() {
      this.filteredDependencies.forEach((dep) => {
        this.selectedRows.add(dep.rowKey || dep.packageName);
      });
      this.updateBulkUpdateButton();
      this.render();
    }

    deselectAll() {
      this.selectedRows.clear();
      this.updateBulkUpdateButton();
      this.render();
    }

    executeBulkUpdate() {
      if (this.selectedRows.size === 0) return;

      // Collect selected packages with their latest versions
      const packages = [];
      this.allDependencies.forEach((dep) => {
        const key = dep.rowKey || dep.packageName;
        if (this.selectedRows.has(key) && dep.hasUpdate) {
          const workspaceFolder =
            this.isSinglePackageProject || !dep.workspaceFolder ? '' : dep.workspaceFolder;
          const packageRoot =
            this.isSinglePackageProject || !dep.packageRoot ? '' : dep.packageRoot;
          packages.push({
            name: dep.packageName,
            version: dep.latestVersion,
            workspaceFolder,
            packageRoot,
          });
        }
      });

      if (packages.length === 0) {
        return;
      }

      // Send bulk update message to extension
      vscode.postMessage({
        command: 'bulkUpdate',
        data: { packages },
      });

      // Clear selection after initiating update
      this.deselectAll();
    }
  };

  // Initialize table manager
  if (!window.tableManager) {
    window.tableManager = new window.TableManager();
  }
  globalThis.__depPulseTableManager = window.tableManager;
}

function wireSelectAllCheckbox() {
  const selectAllCheckbox = document.getElementById('select-all');
  const manager = globalThis.__depPulseTableManager;
  if (!selectAllCheckbox || !manager) {
    return;
  }

  // Remove any existing event listeners by cloning and replacing
  const newCheckbox = selectAllCheckbox.cloneNode(true);
  selectAllCheckbox.parentNode?.replaceChild(newCheckbox, selectAllCheckbox);

  // Add event listener to the new checkbox
  newCheckbox.addEventListener('change', (e) => {
    const currentManager = globalThis.__depPulseTableManager;
    if (!currentManager) return;
    if (e.target.checked) {
      currentManager.selectAll();
    } else {
      currentManager.deselectAll();
    }
  });

  manager.updateHeaderCheckboxState();
}
