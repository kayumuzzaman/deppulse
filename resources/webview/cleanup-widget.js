// Cleanup widget state and UI (inline card)
(() => {
  const vscodeApi =
    window.vscode || (typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null);
  if (vscodeApi) {
    window.vscode = vscodeApi;
  }

  const state = {
    status: 'idle', // idle | loading | ok | empty | error | executing | success
    totalUnused: 0,
    plans: [],
    error: null,
    removed: 0,
  };

  const els = {};

  function $(id) {
    return document.getElementById(id);
  }

  function ensureElements() {
    els.card = els.card || $('cleanup-card');
    els.primaryBtn = els.primaryBtn || $('cleanup-preview-btn');
    els.primaryLabel = els.primaryLabel || $('cleanup-preview-label');
    els.confirmBtn = els.confirmBtn || $('cleanup-confirm-btn');
    els.confirmLabel = els.confirmLabel || $('cleanup-confirm-label');
    els.status = els.status || $('cleanup-status');
    els.list = els.list || $('cleanup-list');
    els.count = els.count || $('cleanup-count');
    els.badge = els.badge || $('cleanup-badge');
    els.impact = els.impact || $('cleanup-impact');
    els.detail = els.detail || $('cleanup-detail');
    els.steps = els.steps || $('cleanup-steps');
    els.resetBtn = els.resetBtn || $('cleanup-reset-btn');
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function renderList(plans) {
    if (!els.list) return;
    if (!plans || plans.length === 0) {
      els.list.innerHTML =
        '<li class="text-sm text-gray-500 dark:text-gray-400">No unused dependencies detected.</li>';
      return;
    }
    const items = plans
      .map((plan) => {
        const deps = plan.dependencies || [];
        const devDeps = plan.devDependencies || [];
        const targetLabel = plan.targetLabel || 'Unknown package';

        // Combine all dependencies with type indicator
        const allDeps = [
          ...deps.map((dep) => ({ name: dep, type: 'dep' })),
          ...devDeps.map((dep) => ({ name: dep, type: 'devDep' })),
        ];

        const hasAnyDeps = allDeps.length > 0;
        if (!hasAnyDeps) return '';

        const renderChip = (item) => {
          const dotColor =
            item.type === 'dep' ? 'background-color: #3b82f6;' : 'background-color: #a855f7;';
          const chipClass = 'cleanup-chip cleanup-chip-blue';
          return `<span class="${chipClass} inline-flex items-center gap-1.5">
            <span style="width: 8px; height: 8px; border-radius: 50%; ${dotColor} flex-shrink: 0; display: inline-block;"></span>
            <span>${escapeHtml(item.name)}</span>
          </span>`;
        };

        const chips = allDeps.map(renderChip).join('');

        return `
          <li class="text-sm text-gray-800 dark:text-gray-200 space-y-2 list-none border-b border-gray-200 dark:border-gray-700 pb-3 mb-3 last:border-b-0 last:pb-0 last:mb-0">
            <div class="font-semibold text-gray-900 dark:text-gray-100 mb-2">${escapeHtml(targetLabel)}</div>
            <div class="flex flex-wrap gap-1.5">${chips}</div>
          </li>
        `;
      })
      .filter((item) => item !== '')
      .join('');
    els.list.innerHTML = items;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function setLoading(isLoading) {
    if (els.primaryBtn) {
      els.primaryBtn.disabled = isLoading;
      els.primaryBtn.classList.toggle('opacity-50', isLoading);
      els.primaryBtn.classList.toggle('cursor-not-allowed', isLoading);
      const labelTarget = els.primaryLabel || els.primaryBtn;
      setText(labelTarget, isLoading ? 'Scanning...' : 'Scan unused dependencies');
    }
    if (els.confirmBtn) {
      els.confirmBtn.disabled = isLoading || state.status !== 'ok';
      els.confirmBtn.classList.toggle('opacity-50', els.confirmBtn.disabled);
      els.confirmBtn.classList.toggle('cursor-not-allowed', els.confirmBtn.disabled);
    }
  }

  function renderStatus() {
    if (!els.status) return;
    const safeError = escapeHtml(state.error || 'Unknown error');
    let content = '';
    switch (state.status) {
      case 'loading':
        content = `<div class="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><span class="animate-spin">⏳</span><span>Scanning for unused dependencies...</span></div>`;
        break;
      case 'ok':
        content = '';
        break;
      case 'empty':
        content = `<div class="text-sm text-gray-600 dark:text-gray-300">No unused dependencies detected.</div>`;
        break;
      case 'error':
        content = `<div class="text-sm text-red-700 dark:text-red-400">Unable to fetch unused dependencies: ${safeError}</div>`;
        break;
      case 'executing':
        content = `<div class="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300"><span class="animate-spin">⏳</span><span>Removing unused dependencies...</span></div>`;
        break;
      case 'success':
        content = `<div class="text-sm text-green-700 dark:text-green-300 font-medium">Removed ${state.removed} unused ${state.removed === 1 ? 'dependency' : 'dependencies'}.</div>`;
        break;
      default:
        content = '';
    }
    els.status.innerHTML = content;
  }

  function updateUI() {
    ensureElements();
    if (!els.card) return;
    const showDetail = state.status === 'ok' && state.plans.length > 0;

    if (els.badge) {
      els.badge.textContent = state.totalUnused > 0 ? `${state.totalUnused} found` : 'Idle';
      els.badge.classList.toggle('bg-green-100', state.totalUnused > 0);
      els.badge.classList.toggle('text-green-800', state.totalUnused > 0);
      els.badge.classList.toggle('bg-amber-100', state.totalUnused === 0);
      els.badge.classList.toggle('text-amber-800', state.totalUnused === 0);
      els.badge.classList.toggle('dark:bg-amber-900/70', state.totalUnused === 0);
      els.badge.classList.toggle('dark:text-amber-200', state.totalUnused === 0);
    }

    renderStatus();
    setLoading(state.status === 'loading' || state.status === 'executing');
    renderList(state.plans);
    if (els.confirmBtn) {
      els.confirmBtn.classList.toggle('hidden', state.status !== 'ok');
    }

    if (els.detail) {
      els.detail.classList.toggle('hidden', !showDetail);
    }

    if (els.steps) {
      els.steps.classList.toggle('hidden', showDetail);
    }

    if (els.count) {
      // Calculate counts of regular deps vs dev deps
      let depsCount = 0;
      let devDepsCount = 0;
      if (state.plans && state.plans.length > 0) {
        state.plans.forEach((plan) => {
          depsCount += (plan.dependencies || []).length;
          devDepsCount += (plan.devDependencies || []).length;
        });
      }

      // Build count label with color indicators
      const mainLabel = `${state.totalUnused} unused ${state.totalUnused === 1 ? 'dep.' : 'deps.'}`;
      const parts = [];

      if (depsCount > 0) {
        parts.push(
          `<span class="inline-flex items-center gap-1.5">
            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6; flex-shrink: 0; display: inline-block;"></span>
            <span>${depsCount} ${depsCount === 1 ? 'dep' : 'deps'}</span>
          </span>`
        );
      }
      if (devDepsCount > 0) {
        parts.push(
          `<span class="inline-flex items-center gap-1.5">
            <span style="width: 8px; height: 8px; border-radius: 50%; background-color: #a855f7; flex-shrink: 0; display: inline-block;"></span>
            <span>${devDepsCount} dev ${devDepsCount === 1 ? 'dep' : 'deps'}</span>
          </span>`
        );
      }

      if (parts.length > 0) {
        els.count.innerHTML = `<span class="text-sm font-semibold text-purple-800 dark:text-purple-100">${mainLabel}</span> <span class="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 ml-2">${parts.join('')}</span>`;
      } else {
        els.count.innerHTML = `<span class="text-sm font-semibold text-purple-800 dark:text-purple-100">${mainLabel}</span>`;
      }
      els.count.classList.toggle('hidden', !showDetail);
    }

    if (els.resetBtn) {
      const disableReset = state.status === 'loading' || state.status === 'executing';
      els.resetBtn.disabled = disableReset;
      els.resetBtn.classList.toggle('opacity-50', disableReset);
      els.resetBtn.classList.toggle('cursor-not-allowed', disableReset);
      els.resetBtn.classList.toggle('hidden', state.status === 'idle');
    }
  }

  function requestPreview() {
    if (!vscodeApi) return;
    state.status = 'loading';
    state.error = null;
    state.plans = [];
    state.totalUnused = 0;
    updateUI();
    vscodeApi.postMessage({ command: 'cleanupUnusedPackages.preview' });
  }

  function requestExecute() {
    if (!vscodeApi) return;
    state.status = 'executing';
    updateUI();
    vscodeApi.postMessage({ command: 'cleanupUnusedPackages.execute' });
  }

  function resetCleanup() {
    state.status = 'idle';
    state.totalUnused = 0;
    state.plans = [];
    state.error = null;
    state.removed = 0;
    if (els.list) {
      els.list.innerHTML = '';
    }
    updateUI();
  }

  function handlePreviewMessage(data) {
    if (!data) return;
    switch (data.status) {
      case 'loading':
        state.status = 'loading';
        break;
      case 'ok':
        state.status = 'ok';
        state.totalUnused = data.totalUnused || 0;
        state.plans = data.plans || [];
        break;
      case 'empty':
        state.status = 'empty';
        state.totalUnused = 0;
        state.plans = [];
        break;
      case 'error':
        state.status = 'error';
        state.error = data.message;
        break;
      default:
        break;
    }
    updateUI();
  }

  function handleResultMessage(data) {
    if (!data) return;
    switch (data.status) {
      case 'executing':
        state.status = 'executing';
        break;
      case 'ok':
        state.status = 'success';
        state.removed = data.removed || 0;
        break;
      case 'empty':
        state.status = 'empty';
        break;
      case 'error':
        state.status = 'error';
        state.error = data.message;
        break;
      default:
        break;
    }
    updateUI();
  }

  function initCleanupWidget() {
    ensureElements();
    if (!els.card) return;

    if (els.primaryBtn) {
      els.primaryBtn.addEventListener('click', requestPreview);
    }

    if (els.confirmBtn) {
      els.confirmBtn.addEventListener('click', requestExecute);
    }

    if (els.resetBtn) {
      els.resetBtn.addEventListener('click', resetCleanup);
    }

    updateUI();
  }

  // Expose handlers for dashboard-core
  window.updateCleanupWidget = (message) => {
    if (message.type === 'unusedPackagesPreview') {
      handlePreviewMessage(message.data);
    } else if (message.type === 'unusedPackagesResult') {
      handleResultMessage(message.data);
    }
  };

  document.addEventListener('DOMContentLoaded', initCleanupWidget);
})();
