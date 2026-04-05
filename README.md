# DepPulse

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/)
[![Open VSX](https://img.shields.io/badge/Open%20VSX-Marketplace-purple)](https://open-vsx.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![CI](https://github.com/A-xoLab/dep-pulse/workflows/CI/badge.svg)](https://github.com/A-xoLab/dep-pulse/actions)

**Real-time dependency health monitoring for Visual Studio Code.**

🌐 **[Visit our website →](https://dep-pulse.vercel.app/)**

DepPulse is a powerful VS Code extension that provides comprehensive dependency analysis, security vulnerability detection, and health scoring for your JavaScript/TypeScript projects. Get instant insights into your dependency ecosystem directly in your editor.

## Why DepPulse?

Modern software projects depend on hundreds or thousands of third-party packages. Managing these dependencies effectively requires:

- **Security Awareness**: Knowing which packages have vulnerabilities and how critical they are
- **Freshness Tracking**: Identifying outdated packages that may lack features or security patches
- **License Compliance**: Ensuring dependencies comply with your project's license requirements
- **Health Monitoring**: Understanding the overall health of your dependency ecosystem

DepPulse solves these challenges by providing:

✅ **Real-time Analysis** - Automatic scanning when you open your workspace  
✅ **Multi-Source Security Scanning** - OSV and GitHub Advisory Database integration  
✅ **Smart Caching** - Fast subsequent scans with intelligent cache invalidation  
✅ **Monorepo Support** - Works seamlessly with npm, pnpm, and yarn workspaces  
✅ **Interactive Dashboard** - Beautiful, filterable UI with detailed vulnerability information  
✅ **Health Scoring** - Weighted scoring system to track overall dependency health  
✅ **Offline Support** - Works with cached data when offline  

## Features

### 🔒 Security Analysis

- **Multi-source vulnerability detection**:
  - **OSV** (Primary): Free, unlimited API with comprehensive CVE data
  - **GitHub Advisory Database**: Automatic fallback for reliability
- **CVSS scoring** with version tracking (v2.0, v3.0, v3.1, v4.0)
- **Accurate semver range matching** for affected versions
- **Source attribution badges** showing data origin

### 📊 Freshness Analysis

- **Unmaintained detection**: Identifies packages without updates for 2+ years (configurable)
- **Version gap detection**: Major, minor, and patch level outdated packages
- **Grace period support**: Configurable grace period for major version updates
- **Pre-release filtering**: Excludes pre-release versions from outdated detection

### 📜 License Compliance

- **License detection**: Automatically extracts license information from packages
- **Compatibility checking**: Validates dependency licenses against your project license
- **Configurable acceptable licenses**: Define which licenses are acceptable for your project
- **Strict mode**: Option to only allow permissive licenses

### 🎯 Health Scoring

- **Weighted scoring system**: Customizable weights for security (40%), freshness (30%), compatibility (20%), and license (10%)
- **Detailed breakdowns**: See exactly what's affecting your health score
- **Status bar integration**: Quick health indicator in VS Code status bar

### 🚀 Performance & Reliability

- **Smart caching**: Tiered caching with severity-based TTL
- **Offline support**: Works with cached data when network is unavailable
- **Incremental scanning**: Only re-analyzes changed dependencies
- **Chunked processing**: Handles large projects efficiently (configurable chunk size)
- **Request queue management**: Concurrent request control with retry logic

### 🎨 User Experience

- **Interactive dashboard**: Filterable, searchable UI with expandable details
- **Auto-scan**: Automatic scanning on workspace open and file changes
- **Real-time updates**: Dashboard updates automatically when dependencies change
- **Unused dependency detection**: Find and remove unused packages (monorepo-aware)
- **LLM-powered alternatives**: Get AI-suggested alternatives for problematic packages

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "DepPulse"
4. Click Install

## Quick Start

1. **Open a workspace** containing `package.json`
2. DepPulse automatically activates and scans your dependencies
3. **View the health score** in the VS Code status bar
4. **Open the dashboard** via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) → `DepPulse: Show Dashboard`



> **Note**: OSV requires no token and works out of the box. GitHub requires token to scan.

### Quick Setup: GitHub Token

For reliable vulnerability scanning with GitHub Advisory Database:

1. **Create token**: Visit [GitHub Settings → Tokens](https://github.com/settings/tokens)
   - Click "Generate new token (classic)"
   - Name it: `DepPulse VS Code Extension`
   - **No scopes needed** (leave all unchecked)
   - Copy the token

2. **Configure in VS Code**:
   - Command Palette → `DepPulse: Configure API Secrets`
   - Select the GitHub token entry and paste your GitHub token

3. **Select GitHub as the primary source** (optional but recommended if you want GitHub to be used instead of OSV):
   - Open VS Code Settings → search for `DepPulse`
   - Under `DepPulse › Vulnerability Detection › Primary Source`, choose **`github`** instead of **`osv`**

4. **Verify**: Run `DepPulse: Scan Dependencies` and check the Output panel


## Usage

### Available Commands

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

- **`DepPulse: Scan Dependencies`** - Manually trigger a full dependency scan
- **`DepPulse: Show Dashboard`** - Open the interactive dependency health dashboard
- **`DepPulse: Remove Unused Dependencies`** - Find and remove unused dependencies (monorepo-aware)
- **`DepPulse: Configure Settings`** - Open DepPulse settings
- **`DepPulse: Configure API Secrets`** - Configure GitHub token and LLM API keys
- **`DepPulse: Force Refresh (Bypass Cache)`** - Force fresh scan, bypassing all caches

### Dashboard Features

- **Filter by classification**: Security, Unmaintained, Outdated, Healthy
- **Search**: Search by package name, CVE ID, or vulnerability title
- **Expandable details**: Click any package to see all detected issues
- **Vulnerability information**: CVSS scores, affected/patched versions
- **Quick actions**: Remove unused dependencies directly from dashboard

## Configuration

Access settings via VS Code Settings (`Ctrl+,` / `Cmd+,`) → search "DepPulse"

### Analysis Settings

```json
{
  "depPulse.analysis.autoScanOnStartup": true,
  "depPulse.analysis.scanOnSave": true,
  "depPulse.analysis.strategy": "auto",
  "depPulse.analysis.includeTransitiveDependencies": true,
  "depPulse.analysis.chunkSize": 50
}
```

- **`autoScanOnStartup`**: Automatically scan when workspace opens (default: `true`)
- **`scanOnSave`**: Automatically scan when dependency files change (default: `true`)
- **`strategy`**: Scanning strategy - `auto` (try native, fallback to static), `native` (use package manager CLI), or `static` (parse lock files)
- **`includeTransitiveDependencies`**: Include transitive dependencies in analysis (default: `true`)
- **`chunkSize`**: Number of dependencies to process per chunk (default: `50`)

### Health Score Weights

Customize scoring priorities (must sum to 1.0):

```json
{
  "depPulse.healthScore.weights.security": 0.4,
  "depPulse.healthScore.weights.freshness": 0.3,
  "depPulse.healthScore.weights.compatibility": 0.2,
  "depPulse.healthScore.weights.license": 0.1
}
```

### Vulnerability Detection

```json
{
  "depPulse.vulnerabilityDetection.primarySource": "osv",
  "depPulse.cache.vulnerabilityTTLMinutes": 60,
  "depPulse.cache.bypassCacheForCritical": true
}
```

- **`primarySource`**: `osv` (default) or `github`
- **`vulnerabilityTTLMinutes`**: Cache duration (15-120 minutes, default: `60`)
- **`bypassCacheForCritical`**: Always fetch fresh data for critical vulnerabilities (default: `true`)

### Freshness Thresholds

```json
{
  "depPulse.freshness.unmaintainedThresholdDays": 730,
  "depPulse.freshness.majorVersionGracePeriodDays": 90
}
```

- **`unmaintainedThresholdDays`**: Days without updates to mark as unmaintained (365-1095, default: `730`)
- **`majorVersionGracePeriodDays`**: Grace period for major version updates (0-365, default: `90`)

### License Configuration

```json
{
  "depPulse.licenses.acceptableLicenses": [
    "MIT",
    "ISC",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause"
  ],
  "depPulse.licenses.strictMode": false,
  "depPulse.licenses.projectLicense": "MIT"
}
```

See [Configuration Documentation](docs/TECHNICAL.md#configuration-system) for complete settings reference.

## Architecture

DepPulse uses a modular, layered architecture:

```
┌─────────────────────────────────────────┐
│         Extension Layer                 │
│    (VS Code Integration)               │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│            UI Layer                      │
│  (Dashboard, Status Bar)                │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│         Analyzer Layer                   │
│  (Security, Freshness, License)          │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│          API Layer                       │
│  (OSV, GitHub, npm Registry)            │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│        Scanner Layer                     │
│  (Dependency Detection & Parsing)       │
└──────────────────────────────────────────┘
```

See [Technical Documentation](docs/TECHNICAL.md) for detailed architecture and design decisions.

## Supported Package Managers

- ✅ **npm** - Full support
- ✅ **pnpm** - Full support (including workspaces)
- ✅ **Yarn** - Full support (including workspaces)
- 🔄 **pip** (Python) - Planned
- 🔄 **Maven/Gradle** (Java) - Future consideration

## Requirements

- **VS Code**: 1.80.0 or higher
- **Node.js**: 20.18.1+ (for development)
- **Package Manager**: npm, pnpm, or Yarn

## Troubleshooting

### Extension Not Activating

- Ensure your workspace contains a `package.json` file
- Check the Output panel (`View → Output → DepPulse`) for error messages
- Verify VS Code version is 1.80.0 or higher

### Scan Not Running

- Check network connectivity (OSV.dev and npm registry)
- Verify `depPulse.analysis.autoScanOnStartup` is enabled
- Try manual scan via Command Palette: `DepPulse: Scan Dependencies`
- Check Output panel for detailed error messages

### Vulnerabilities Not Detected

- Verify `depPulse.vulnerabilityDetection.primarySource` is set correctly
- For GitHub source: Ensure GitHub token is configured
- Try force refresh: `DepPulse: Force Refresh (Bypass Cache)`
- Check cache settings: Critical vulnerabilities bypass cache by default

### Performance Issues

- Reduce `depPulse.analysis.chunkSize` for large projects
- Disable `depPulse.analysis.includeTransitiveDependencies` if not needed
- Increase `depPulse.cache.vulnerabilityTTLMinutes` for better caching
- Check network connectivity (slow networks affect scan time)

### Dashboard Not Loading

- Check browser console (right-click dashboard → Inspect)
- Try reloading VS Code window (`Ctrl+R` / `Cmd+R`)

For more help, see [Technical Documentation](docs/TECHNICAL.md) or [open an issue](https://github.com/A-xoLab/dep-pulse/issues).

## Roadmap

### Phase 2 (Planned)

- 🔄 **Python/pip support** - Analyze Python dependencies
- 🔄 **Bundle size analysis** - Track package sizes and impact
- 🔄 **Dependency tree visualization** - Interactive dependency graph
- 🔄 **Smart update suggestions** - AI-powered update recommendations
- 🔄 **Notification system** - Alerts for critical vulnerabilities

### Future Considerations

- Multi-language support (Java, Go, Rust)
- CI/CD integration
- Team collaboration features
- Historical trend tracking

See [Contributing](CONTRIBUTING.md) to help shape DepPulse's future.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Development setup instructions
- Coding standards and guidelines
- Testing requirements
- Pull request process

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- [OSV.dev](https://osv.dev) - Open Source Vulnerabilities database
- [GitHub Security Advisories](https://github.com/advisories) - Security advisory database
- [npm Registry](https://www.npmjs.com/) - Package registry

---

**Made with ❤️ for the VS Code community**

🌐 **[Visit our website](https://dep-pulse.vercel.app/)** | [GitHub Repository](https://github.com/A-xoLab/dep-pulse) | [Report an Issue](https://github.com/A-xoLab/dep-pulse/issues)
