# Changelog

All notable changes to DepPulse will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.0] - 2026-04-09

### Added

- **Transitive vulnerability awareness** — aggregate vulnerability alert banner on the dashboard surfaces inherited risk from indirect dependencies with severity chips, affected-package navigation, and a "show more" toggle
- Transitive sub-indicators on Critical and High metric cards showing additional vulnerability counts from transitive deps
- "Transitive vulns" filter toggle in the table toolbar integrated into FilterManager (state, active-filter tags, clear)
- Navigate-to-package action that scrolls to a dependency row and auto-opens its transitive tab

### Fixed

- Workspace-scoped scanning now correctly resolves the chosen workspace folder for multi-root projects
- Export notifications show the actual chosen file path instead of a generic message
- Hardened webview security: escaped HTML attributes in dashboard table to prevent XSS
- Restored safe package name rendering, dashboard tab interactions, and cross-platform command execution
- Connectivity check replaced raw `node:https` with axios for reliable proxy/editor compatibility
- Eliminated false "Limited connectivity" banners caused by transient per-package npm blips or stale cached `networkStatus`
- `navigator.onLine` no longer drives the offline banner — real connectivity state from the extension host is used instead
- Added un-layered CSS background overrides so the dashboard renders correctly across VS Code forks
- Removed duplicate lockfile from the codebase

## [0.1.1] - 2025-12-20

### Fixed

- Fixed extension signature verification issue when installing from VS Code Marketplace
  - Updated release workflow to use `vsce publish` without `--packagePath` flag
  - This ensures proper automatic signing by VS Code Marketplace during publish
  - Added `install:local` script for easier local development installation

## [0.1.0] - 2025-12-19

### Added

- Initial release
- Dependency scanning for npm/pnpm/yarn projects
- Security vulnerability detection via OSV and GitHub Advisory Database
- Freshness analysis with outdated package detection
- License compliance checking
- Interactive dashboard UI
- Health score calculation
- Monorepo support
- Real-time analysis with automatic scanning on workspace open
- Smart caching with severity-based TTL
- Offline support with cached data
- CVSS scoring with version tracking (v2.0, v3.0, v3.1, v4.0)
- Accurate semver range matching for affected versions
- Unmaintained package detection (configurable threshold)
- Version gap detection (major, minor, patch levels)
- Grace period support for major version updates
- Pre-release filtering for outdated detection
- License detection and compatibility checking
- Configurable acceptable licenses
- Strict mode for permissive licenses only
- Weighted health scoring system (customizable weights)
- Status bar integration for quick health indicator
- Incremental scanning for changed dependencies only
- Chunked processing for large projects
- Request queue management with retry logic
- Multi-source security scanning with automatic fallback
- Source attribution badges
- Filterable and searchable dashboard
- Unused dependency detection (monorepo-aware)
- LLM-powered alternatives for problematic packages
