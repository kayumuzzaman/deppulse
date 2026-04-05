# Contributing to DepPulse

Thank you for your interest in contributing to DepPulse! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Setup](#development-setup)
4. [Project Structure](#project-structure)
5. [Coding Standards](#coding-standards)
6. [Testing Guidelines](#testing-guidelines)
7. [Pull Request Process](#pull-request-process)
8. [Issue Reporting](#issue-reporting)
9. [Feature Requests](#feature-requests)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please be respectful, inclusive, and constructive in all interactions.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: 20.18.1 or higher
- **pnpm**: Latest version (we use pnpm, not npm)
- **VS Code**: 1.80.0 or higher (for development)
- **Git**: For version control

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/dep-pulse.git
   cd dep-pulse
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/A-xoLab/dep-pulse.git
   ```

## Development Setup

### Installation

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Compile TypeScript**:
   ```bash
   pnpm run compile
   ```

3. **Build CSS** (if modifying webview styles):
   ```bash
   pnpm run build:css
   ```

### Development Workflow

1. **Create a branch**:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Make your changes**:
   - Write code following our [coding standards](#coding-standards)
   - Add tests for new features
   - Update documentation as needed

3. **Run tests**:
   ```bash
   # Run all tests
   pnpm test

   # Run tests in watch mode
   pnpm test:watch

   # Run with UI
   pnpm test:ui

   # Run integration tests
   pnpm test:integration

   # Run property-based tests
   pnpm test:property
   ```

4. **Check code quality**:
   ```bash
   # Format code
   pnpm format

   # Lint code
   pnpm lint

   # Fix linting issues
   pnpm lint:fix

   # Type check
   pnpm type-check

   # Run all checks
   pnpm validate
   ```

5. **Test in VS Code**:
   - Press `F5` in VS Code to launch Extension Development Host
   - Test your changes in the new VS Code window
   - Check the Output panel (`View → Output → DepPulse`) for logs

### Watch Mode

For faster development iteration:

```bash
# Watch TypeScript compilation
pnpm watch

# In another terminal, watch CSS
pnpm build:css --watch
```

## Project Structure

```
DepPulse/
├── src/                    # TypeScript source code
│   ├── analyzer/          # Analysis components (security, freshness, license)
│   ├── api/               # API clients (OSV, GitHub, npm)
│   ├── config/            # Configuration management
│   ├── extension.ts       # Main extension entry point
│   ├── scanner/           # Dependency scanning
│   ├── types/             # TypeScript type definitions
│   ├── ui/                # UI components (dashboard, status bar)
│   └── utils/             # Utility functions
├── resources/             # Static resources
│   └── webview/          # Dashboard webview files
├── out/                   # Compiled JavaScript (generated)
├── docs/                  # Documentation
├── package.json           # Project configuration
├── tsconfig.json          # TypeScript configuration
├── biome.json            # Biome linter/formatter config
└── vitest.config.ts      # Test configuration
```

### Key Directories

- **`src/analyzer/`**: Core analysis logic
  - `AnalysisEngine.ts`: Coordinates all analyzers
  - `SecurityAnalyzer.ts`: Vulnerability analysis
  - `FreshnessAnalyzer.ts`: Package freshness analysis
  - `LicenseAnalyzer.ts`: License compliance analysis
  - `HealthScoreCalculator.ts`: Health score calculation

- **`src/api/`**: External API clients
  - `OSVClient.ts`: OSV API client
  - `GitHubAdvisoryClient.ts`: GitHub Advisory API client
  - `NpmRegistryClient.ts`: npm registry client

- **`src/scanner/`**: Dependency scanning
  - `NodeJsScanner.ts`: Main scanner facade
  - `strategies/`: Scanning strategies (native, static)

- **`src/ui/`**: User interface
  - `DashboardController.ts`: Dashboard logic
  - `StatusBarManager.ts`: Status bar integration

## Coding Standards

### TypeScript Conventions

- **Use TypeScript strict mode**: All code must pass strict type checking
- **Avoid `any`**: Use proper types or `unknown` with type guards
- **Use Node.js import protocol**: `import * as fs from 'node:fs'` (not `'fs'`)
- **Prefer `const`**: Use `const` unless reassignment is needed
- **No non-null assertions**: Avoid `!` operator; use proper null checks

### Code Style

We use [Biome](https://biomejs.dev/) for formatting and linting. Configuration is in `biome.json`.

**Key Rules**:
- **Indentation**: 2 spaces
- **Line width**: 100 characters
- **Quotes**: Single quotes for strings
- **Semicolons**: Always required
- **Trailing commas**: ES5 style

**Format code**:
```bash
pnpm format
```

**Check formatting**:
```bash
pnpm format:check
```

### Naming Conventions

- **Files**: `PascalCase.ts` for classes, `camelCase.ts` for utilities
- **Classes**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`
- **Interfaces/Types**: `PascalCase` (often prefixed with `I` for interfaces)

### Code Organization

- **One class per file**: Each file should export one main class
- **Barrel exports**: Use `index.ts` files for clean imports
- **Separation of concerns**: Keep layers separate (API, Analyzer, UI)
- **Dependency injection**: Pass dependencies through constructors

### Documentation

- **JSDoc comments**: Document public APIs
- **Inline comments**: Explain complex logic
- **README updates**: Update README for user-facing changes
- **Technical docs**: Update `docs/TECHNICAL.md` for architectural changes

**Example JSDoc**:
```typescript
/**
 * Analyzes dependencies for security vulnerabilities
 * @param dependencies List of dependencies to analyze
 * @param options Analysis options
 * @returns Security analysis results
 */
async analyze(
  dependencies: Dependency[],
  options?: AnalysisOptions
): Promise<SecurityAnalysis> {
  // Implementation
}
```

## Testing Guidelines

### Test Types

1. **Unit Tests**: Test individual functions/classes in isolation
2. **Integration Tests**: Test component interactions
3. **Property-Based Tests**: Use fast-check for property testing
4. **Contract Tests**: Test API contracts

### Writing Tests

**Test File Naming**:
- Unit tests: `*.test.ts`
- Integration tests: `*.integration.test.ts`
- Property tests: `*.property.test.ts`
- Contract tests: `*.contract.test.ts`

**Test Structure**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('ClassName', () => {
  beforeEach(() => {
    // Setup
  });

  it('should do something', () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test src/analyzer/AnalysisEngine.test.ts

# Run tests in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage

# Run integration tests only
pnpm test:integration
```

### Test Coverage

- Aim for high coverage (>80%) on critical paths
- Focus on edge cases and error handling
- Don't sacrifice code quality for coverage metrics

## Pull Request Process

### Before Submitting

1. **Update documentation**: Update README, technical docs, or CHANGELOG as needed
2. **Add tests**: Ensure new features have tests
3. **Run checks**: All tests and linting must pass
   ```bash
   pnpm validate
   ```
4. **Test manually**: Test in VS Code Extension Development Host
5. **Update CHANGELOG**: Add entry for your changes

### PR Checklist

- [ ] Code follows coding standards
- [ ] Tests added/updated and passing
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] No linting errors
- [ ] Type checking passes
- [ ] Manually tested in VS Code

### Branch Naming

Use descriptive branch names:

- `feature/description`: New features
- `fix/description`: Bug fixes
- `docs/description`: Documentation changes
- `refactor/description`: Code refactoring
- `test/description`: Test improvements

### Commit Messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting (no code change)
- `refactor`: Code refactoring
- `perf`: Performance improvement
- `test`: Test changes
- `build`: Build system changes
- `ci`: CI changes
- `chore`: Other changes

**Examples**:
```
feat(analyzer): add support for Python dependencies

Add pip/PyPI support to the scanner layer with lock file parsing.

Closes #123
```

```
fix(api): handle GitHub API rate limits gracefully

Add exponential backoff and retry logic for rate limit errors.

Fixes #456
```

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manually tested in VS Code

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests pass locally
```

### Review Process

1. **Automated checks**: CI runs tests and linting
2. **Code review**: At least one maintainer must approve
3. **Feedback**: Address review comments
4. **Merge**: Squash and merge (maintainers only)

## Issue Reporting

### Bug Reports

Use the bug report template and include:

- **Description**: Clear description of the bug
- **Steps to reproduce**: Minimal steps to reproduce
- **Expected behavior**: What should happen
- **Actual behavior**: What actually happens
- **Environment**:
  - VS Code version
  - Extension version
  - OS version
  - Node.js version
- **Logs**: Relevant logs from Output panel
- **Screenshots**: If applicable

### Feature Requests

Use the feature request template and include:

- **Problem**: What problem does this solve?
- **Proposed solution**: How should it work?
- **Alternatives**: Other solutions considered
- **Additional context**: Any other relevant information

### Before Requesting

1. Check existing issues to avoid duplicates
2. Review roadmap in README
3. Consider if it fits the project scope

### Requesting Features

- Use the feature request template
- Provide clear use case
- Explain benefits
- Consider implementation complexity

### Implementing Features

1. Discuss in issue first (for large features)
2. Get approval before starting work
3. Follow development workflow
4. Submit PR with tests and docs

## Getting Help

- **Documentation**: Check [Technical Documentation](docs/TECHNICAL.md)
- **Issues**: Search existing issues
- **Discussions**: Use GitHub Discussions for questions
- **Contact**: Open an issue for support

## Additional Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
- [Biome Documentation](https://biomejs.dev/)

---

Thank you for contributing to DepPulse! 🎉
