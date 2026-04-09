// DepPulse Dashboard - Filtering and Search
// Filter management and search functionality

// Note: Uses state from dashboard-state.js, utils from dashboard-utils.js
// Note: Depends on tableManager and cardManager from dashboard-table.js
// Note: Depends on renderCurrentView from dashboard-core.js

// Active chart filter (legacy support)
if (typeof window.activeChartFilter === 'undefined') {
  window.activeChartFilter = null;
}
// var activeChartFilter = window.activeChartFilter; // Unused local variable

/**
 * Filter Manager Class
 * Manages all filtering and search functionality
 */
// Prevent duplicate class declarations
if (typeof window.FilterManager === 'undefined') {
  window.FilterManager = class FilterManager {
    constructor() {
      this.state = {
        search: '',
        severity: 'all',
        freshness: 'all',
        transitiveVulns: false,
      };
    }

    updateSearch(value) {
      this.state.search = value.toLowerCase();
      this.applyFilters();
    }

    updateSeverity(value) {
      this.state.severity = value;
      this.applyFilters();
    }

    updateFreshness(value) {
      this.state.freshness = value;
      this.applyFilters();
    }

    updateTransitiveVulns(checked) {
      this.state.transitiveVulns = checked;
      this.applyFilters();
    }

    applyChartFilter(type, value) {
      // Update dropdown to reflect chart filter and reset the other filter
      const severityFilter = document.getElementById('severity-filter');
      const freshnessFilter = document.getElementById('freshness-filter');

      if (type === 'severity') {
        if (severityFilter) severityFilter.value = value;
        if (freshnessFilter) freshnessFilter.value = 'all';
        this.state.severity = value;
        this.state.freshness = 'all';
      } else if (type === 'freshness') {
        if (freshnessFilter) freshnessFilter.value = value;
        if (severityFilter) severityFilter.value = 'all';
        this.state.freshness = value;
        this.state.severity = 'all';
      }

      this.applyFilters();
    }

    clearFilters() {
      this.state = {
        search: '',
        severity: 'all',
        freshness: 'all',
        transitiveVulns: false,
      };

      // Reset UI controls
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = '';

      const severityFilter = document.getElementById('severity-filter');
      if (severityFilter) severityFilter.value = 'all';

      const freshnessFilter = document.getElementById('freshness-filter');
      if (freshnessFilter) freshnessFilter.value = 'all';

      const transitiveVulnFilter = document.getElementById('transitive-vuln-filter');
      if (transitiveVulnFilter) transitiveVulnFilter.checked = false;

      this.applyFilters();
    }

    applyFilters() {
      if (!window.currentDashboardData) {
        this.updateFilterUI();
        return;
      }

      let filtered = window.currentDashboardData.dependencies;

      // Apply search filter
      if (this.state.search) {
        filtered = filtered.filter((dep) => {
          return this.matchesSearch(dep, this.state.search);
        });
      }

      // Apply severity filter
      if (this.state.severity !== 'all') {
        filtered = filtered.filter((dep) => dep.severity === this.state.severity);
      }

      // Apply freshness filter
      if (this.state.freshness !== 'all') {
        filtered = filtered.filter((dep) => this.matchesFreshness(dep, this.state.freshness));
      }

      // Apply transitive vulnerability filter
      if (this.state.transitiveVulns) {
        filtered = filtered.filter((dep) => this.hasTransitiveVulns(dep));
      }

      // Update both managers with filtered data
      // These will be defined in dashboard-table.js
      if (typeof tableManager !== 'undefined') {
        tableManager.filteredDependencies = filtered;
        tableManager.currentPage = 1;
      }

      if (typeof cardManager !== 'undefined') {
        cardManager.filteredDependencies = filtered;
        cardManager.currentPage = 1;
      }

      // Render current view (defined in dashboard-core.js)
      if (typeof renderCurrentView === 'function') {
        renderCurrentView();
      }

      // Update UI
      this.updateFilterUI();

      // Announce filter results to screen readers
      this.announceFilterResults(filtered.length);
    }

    announceFilterResults(count) {
      let message = '';

      if (this.hasActiveFilters()) {
        const filters = [];
        if (this.state.search) filters.push(`search: ${this.state.search}`);
        if (this.state.severity !== 'all') filters.push(`severity: ${this.state.severity}`);
        if (this.state.freshness !== 'all') filters.push(`freshness: ${this.state.freshness}`);
        if (this.state.transitiveVulns) filters.push('has transitive vulnerabilities');

        message = `Filtered to ${count} ${count === 1 ? 'dependency' : 'dependencies'} with ${filters.join(', ')}`;
      } else {
        message = `Showing all ${count} ${count === 1 ? 'dependency' : 'dependencies'}`;
      }

      if (typeof announceToScreenReader === 'function') {
        announceToScreenReader(message);
      }
    }

    matchesSearch(dep, searchTerm) {
      // Search in package name
      if (dep.packageName.toLowerCase().includes(searchTerm)) {
        return true;
      }

      // Search in CVE IDs
      if (dep.cveIds.some((cve) => cve.toLowerCase().includes(searchTerm))) {
        return true;
      }

      // Search in Severity
      if (dep.severity && dep.severity.toLowerCase().includes(searchTerm)) {
        return true;
      }

      // Search in Freshness
      if (dep.freshness && dep.freshness.toLowerCase().includes(searchTerm)) {
        return true;
      }

      return false;
    }

    matchesFreshness(dep, freshness) {
      return dep.freshness === freshness;
    }

    hasTransitiveVulns(dep) {
      if (!dep.children || dep.children.length === 0) return false;
      const dfs = (nodes) => {
        for (const child of nodes) {
          if (child.cveIds && child.cveIds.length > 0) return true;
          if (child.children && dfs(child.children)) return true;
        }
        return false;
      };
      return dfs(dep.children);
    }

    updateFilterUI() {
      const clearBtn = document.getElementById('clear-filters-btn');
      const hasActiveFilters = this.hasActiveFilters();

      if (clearBtn) {
        if (hasActiveFilters) {
          clearBtn.classList.remove('hidden');
        } else {
          clearBtn.classList.add('hidden');
        }
      }

      renderActiveFilterTags(this);
    }

    hasActiveFilters() {
      return (
        this.state.search !== '' ||
        this.state.severity !== 'all' ||
        this.state.freshness !== 'all' ||
        this.state.transitiveVulns === true
      );
    }
  };
}

// Initialize filter manager (make it globally accessible)
if (!window.filterManager) {
  window.filterManager = new window.FilterManager();
}
var filterManager = window.filterManager;

/**
 * Apply chart filter
 * @param {string} type - Filter type ('severity' or 'freshness')
 * @param {string} value - Filter value
 */
function applyChartFilter(type, value) {
  filterManager.applyChartFilter(type, value);
}

/**
 * Clear all filters
 */
function clearAllFilters() {
  // Hide legacy filter badge if present
  const badge = document.getElementById('filter-badge');
  if (badge) {
    badge.textContent = '';
    badge.classList.add('hidden');
  }

  // Clear filters through filter manager
  filterManager.clearFilters();
}

// Expose functions to window
window.applyChartFilter = applyChartFilter;
window.clearAllFilters = clearAllFilters;

/**
 * Render filter tags beneath the filter bar.
 * Supports multiple tags when both dropdowns are active.
 * @param {FilterManager} filterManagerInstance
 */
function renderActiveFilterTags(filterManagerInstance) {
  const container = document.getElementById('active-filters-container');
  if (!container || !filterManagerInstance) return;

  const activeFilters = [];

  if (filterManagerInstance.state.severity !== 'all') {
    activeFilters.push({
      key: 'severity',
      label: 'Severity',
      value: filterManagerInstance.state.severity,
      display: formatFilterValue('severity', filterManagerInstance.state.severity),
    });
  }

  if (filterManagerInstance.state.freshness !== 'all') {
    activeFilters.push({
      key: 'freshness',
      label: 'Freshness',
      value: filterManagerInstance.state.freshness,
      display: formatFilterValue('freshness', filterManagerInstance.state.freshness),
    });
  }

  if (filterManagerInstance.state.transitiveVulns) {
    activeFilters.push({
      key: 'transitiveVulns',
      label: 'Filter',
      value: 'transitiveVulns',
      display: 'Has transitive vulns',
    });
  }

  container.innerHTML = '';

  if (activeFilters.length === 0) {
    container.hidden = true;
    return;
  }

  container.hidden = false;

  activeFilters.forEach((filter) => {
    const accentColor = getFilterAccentColor(filter.key, filter.value);
    const pill = document.createElement('div');
    pill.className = 'filter-pill';
    pill.style.setProperty('--filter-accent', accentColor);
    pill.style.setProperty('--filter-accent-soft', getFilterAccentSoft(accentColor));

    const dot = document.createElement('span');
    dot.className = 'filter-pill__dot';

    const textWrapper = document.createElement('div');
    textWrapper.className = 'filter-pill__text';

    const label = document.createElement('span');
    label.className = 'filter-pill__label';
    label.textContent = filter.label;

    const value = document.createElement('span');
    value.className = 'filter-pill__value';
    value.textContent = filter.display;

    textWrapper.appendChild(label);
    textWrapper.appendChild(value);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.setAttribute('aria-label', `Remove ${filter.label} filter`);
    removeBtn.className = 'filter-pill__remove';
    removeBtn.innerHTML = '<span aria-hidden="true">×</span>';

    removeBtn.addEventListener('click', () => {
      if (filter.key === 'severity') {
        const severityFilter = document.getElementById('severity-filter');
        if (severityFilter) severityFilter.value = 'all';
        filterManagerInstance.updateSeverity('all');
      } else if (filter.key === 'freshness') {
        const freshnessFilter = document.getElementById('freshness-filter');
        if (freshnessFilter) freshnessFilter.value = 'all';
        filterManagerInstance.updateFreshness('all');
      } else if (filter.key === 'transitiveVulns') {
        const transitiveVulnFilter = document.getElementById('transitive-vuln-filter');
        if (transitiveVulnFilter) transitiveVulnFilter.checked = false;
        filterManagerInstance.updateTransitiveVulns(false);
      }
    });

    pill.appendChild(dot);
    pill.appendChild(textWrapper);
    pill.appendChild(removeBtn);
    container.appendChild(pill);
  });
}

/**
 * Format filter values for display in tags.
 * @param {string} type
 * @param {string} value
 * @returns {string}
 */
function formatFilterValue(type, value) {
  const labelMap = {
    severity: {
      critical: 'Critical',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      none: 'None',
    },
    freshness: {
      current: 'Current',
      patch: 'Patch',
      minor: 'Minor',
      major: 'Major',
      unmaintained: 'Unmaintained',
    },
  };

  if (labelMap[type] && labelMap[type][value]) {
    return labelMap[type][value];
  }

  return value;
}

const FALLBACK_FILTER_ACCENT_MAP = {
  severity: {
    critical: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e',
    none: '#94a3b8',
  },
  freshness: {
    current: '#22c55e',
    patch: '#a3e635',
    minor: '#eab308',
    major: '#f97316',
    unmaintained: '#ef4444',
  },
  transitiveVulns: {
    transitiveVulns: '#f59e0b',
  },
};

function getFilterAccentColor(type, value) {
  const hasChartColors = typeof getChartColors === 'function';
  const hasDarkMode = typeof isDarkMode === 'function';

  if (hasChartColors) {
    const chartPalette = getChartColors(hasDarkMode ? isDarkMode() : false);
    if (chartPalette && chartPalette[value]) {
      return chartPalette[value];
    }
  }

  const palette = FALLBACK_FILTER_ACCENT_MAP[type];
  if (palette && palette[value]) {
    return palette[value];
  }

  return '#3b82f6';
}

function getFilterAccentSoft(color) {
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);

  if (match) {
    const [, r, g, b] = match;
    return `rgba(${r}, ${g}, ${b}, 0.14)`;
  }

  // hex or other formats: convert simple hex to rgba
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const bigint = parseInt(
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex,
      16
    );
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, 0.14)`;
  }

  return 'rgba(59, 130, 246, 0.14)';
}
