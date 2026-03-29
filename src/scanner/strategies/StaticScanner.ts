import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  type Dependency,
  type DependencyFile,
  DepPulseError,
  ErrorCode,
  type ProjectInfo,
} from '../../types';
import { Logger } from '../../utils/Logger';
import { NpmLockParser } from '../parsers/NpmLockParser';
import { PnpmLockParser } from '../parsers/PnpmLockParser';
import { YarnLockParser } from '../parsers/YarnLockParser';
import type { ScannerStrategy } from './ScannerStrategy';

export class StaticScanner implements ScannerStrategy {
  private logger = Logger.getInstance();
  private pnpmLockParser = new PnpmLockParser();
  private yarnLockParser = new YarnLockParser();
  private npmLockParser = new NpmLockParser();

  private async loadGitignore(workspaceRoot: string) {
    const dirs = new Set<string>(['node_modules', 'out', 'coverage']);
    const files = new Set<string>(['.env', '.DS_Store']);
    const paths = new Set<string>(['resources/webview/output.css', 'resources/webview/chart.js']);
    const globs = new Set<string>(['*.vsix']);

    try {
      const content = await fs.readFile(path.join(workspaceRoot, '.gitignore'), 'utf-8');
      content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .forEach((line) => {
          const normalized = line.replace(/\\/g, '/');
          if (normalized.endsWith('/')) {
            dirs.add(normalized.slice(0, -1));
          } else if (normalized.includes('/')) {
            paths.add(normalized);
          } else if (normalized.includes('*')) {
            globs.add(normalized);
          } else if (normalized.startsWith('.')) {
            files.add(normalized);
          } else {
            dirs.add(normalized);
          }
        });
    } catch {
      // ignore missing .gitignore
    }

    return { dirs, files, paths, globs };
  }

  private matchesGlob(relPath: string, glob: string): boolean {
    if (glob.startsWith('*.')) {
      return relPath.endsWith(glob.slice(1));
    }
    return false;
  }

  private shouldIgnorePackageJson(
    pkgPath: string,
    workspaceRoot: string,
    gitignore: { dirs: Set<string>; files: Set<string>; paths: Set<string>; globs: Set<string> }
  ): boolean {
    const buildDirs = new Set<string>([
      '.next',
      '.turbo',
      '.cache',
      '.output',
      '.vercel',
      '.expo',
      '.parcel-cache',
      '.docusaurus',
      '.angular',
      '.svelte-kit',
      '.nuxt',
    ]);

    const rel = path.relative(workspaceRoot, pkgPath);
    const relPosix = rel.split(path.sep).join('/');
    const segments = relPosix.split('/');

    if (segments.some((segment) => buildDirs.has(segment))) {
      return true;
    }
    if (segments.some((segment) => gitignore.dirs.has(segment))) {
      return true;
    }
    if (gitignore.paths.has(relPosix)) {
      return true;
    }
    const filename = segments[segments.length - 1] || '';
    if (gitignore.files.has(filename)) {
      return true;
    }
    for (const glob of gitignore.globs) {
      if (this.matchesGlob(relPosix, glob)) return true;
    }
    return false;
  }

  private applyWorkspaceContext(
    deps: Dependency[],
    packageRoot: string,
    workspaceFolder: string,
    isMonorepo: boolean
  ): Dependency[] {
    if (!isMonorepo) {
      return deps;
    }
    return deps.map((dep) => {
      const enriched: Dependency = {
        ...dep,
        packageRoot,
        workspaceFolder,
      };
      if (dep.children) {
        enriched.children = this.applyWorkspaceContext(
          dep.children,
          packageRoot,
          workspaceFolder,
          isMonorepo
        );
      }
      return enriched;
    });
  }

  getName(): string {
    return 'Static (File Parser)';
  }

  async scan(dir: string): Promise<ProjectInfo> {
    this.logger.info(`Starting Static Scan in ${dir}`);

    try {
      const gitignore = await this.loadGitignore(dir);

      // Find all package.json files, excluding node_modules
      // Note: vscode.workspace.findFiles is global, so we need to filter by dir if needed
      // But usually we scan the whole workspace.
      // For strategy consistency, we might want to just scan the specific dir if provided,
      // but findFiles is much faster than recursive fs readdir.

      const packageJsonFiles = (
        await vscode.workspace.findFiles(
          new vscode.RelativePattern(dir, '**/package.json'),
          '**/node_modules/**'
        )
      ).filter((uri) => !this.shouldIgnorePackageJson(uri.fsPath, dir, gitignore));

      const skipped =
        (
          await vscode.workspace.findFiles(
            new vscode.RelativePattern(dir, '**/package.json'),
            '**/node_modules/**'
          )
        ).length - packageJsonFiles.length;
      if (skipped > 0) {
        this.logger.info(`Ignored ${skipped} package.json file(s) due to gitignore/build filters`);
      }

      this.logger.info(`Found ${packageJsonFiles.length} package.json file(s)`);

      const dependencyFiles: DependencyFile[] = [];
      const allDependencies: Dependency[] = [];
      const internalNames = new Set<string>();
      const rootPackagePath = path.join(dir, 'package.json');
      const isMonorepo = packageJsonFiles.some((file) => file.fsPath !== rootPackagePath);

      // Pre-collect internal package names
      for (const fileUri of packageJsonFiles) {
        try {
          const content = await fs.readFile(fileUri.fsPath, 'utf-8');
          const pkg = JSON.parse(content);
          if (typeof pkg.name === 'string' && pkg.name.trim().length > 0) {
            internalNames.add(pkg.name);
          }
        } catch (error) {
          this.logger.warn(`Failed to read package name from ${fileUri.fsPath}: ${error}`);
        }
      }

      // Parse each package.json file
      for (const fileUri of packageJsonFiles) {
        try {
          const dirPath = path.dirname(fileUri.fsPath);
          let depFile: DependencyFile | null = null;

          const lockfile = await this.resolveLockfile(dirPath);
          if (lockfile?.type === 'pnpm') {
            try {
              const importerPath = path.relative(path.dirname(lockfile.path), dirPath) || '.';
              const lockDeps = await this.pnpmLockParser.parse(lockfile.path, importerPath);
              depFile = {
                path: fileUri.fsPath,
                type: 'npm',
                packageRoot: dirPath,
                workspaceFolder: dir,
                dependencies: lockDeps.filter((d) => !d.isDev),
                devDependencies: lockDeps.filter((d) => d.isDev),
              };
              this.logger.info(`Parsed pnpm-lock.yaml for ${fileUri.fsPath}`);
            } catch (error) {
              this.logger.warn(`Failed to parse pnpm lock for ${fileUri.fsPath}: ${error}`);
            }
          } else if (lockfile?.type === 'yarn') {
            try {
              const lockDeps = await this.yarnLockParser.parse(lockfile.path);
              depFile = {
                path: fileUri.fsPath,
                type: 'npm',
                packageRoot: dirPath,
                workspaceFolder: dir,
                dependencies: lockDeps.filter((d) => !d.isDev),
                devDependencies: lockDeps.filter((d) => d.isDev),
              };
              this.logger.info(`Parsed yarn.lock for ${fileUri.fsPath}`);
            } catch (error) {
              this.logger.warn(`Failed to parse yarn lock for ${fileUri.fsPath}: ${error}`);
            }
          } else if (lockfile?.type === 'npm') {
            try {
              const lockDeps = await this.npmLockParser.parse(lockfile.path);
              depFile = {
                path: fileUri.fsPath,
                type: 'npm',
                packageRoot: dirPath,
                workspaceFolder: dir,
                dependencies: lockDeps.filter((d) => !d.isDev),
                devDependencies: lockDeps.filter((d) => d.isDev),
              };
              this.logger.info(`Parsed package-lock.json for ${fileUri.fsPath}`);
            } catch (error) {
              this.logger.warn(`Failed to parse package-lock.json for ${fileUri.fsPath}: ${error}`);
            }
          }

          if (!depFile) {
            depFile = await this.parseDependencyFile(fileUri.fsPath, dir);
          }

          // Mark internal dependencies and attach workspace context for monorepos
          depFile.dependencies = this.applyWorkspaceContext(
            depFile.dependencies.map((d) => this.markInternal(d, internalNames)),
            depFile.packageRoot || dirPath,
            dir,
            isMonorepo
          );
          if (depFile.devDependencies) {
            depFile.devDependencies = this.applyWorkspaceContext(
              depFile.devDependencies.map((d) => this.markInternal(d, internalNames)),
              depFile.packageRoot || dirPath,
              dir,
              isMonorepo
            );
          }

          dependencyFiles.push(depFile);
          allDependencies.push(...depFile.dependencies);
          if (depFile.devDependencies) {
            allDependencies.push(...depFile.devDependencies);
          }
        } catch (error) {
          // Log error but continue with other files
          this.logger.warn(`Failed to parse ${fileUri.fsPath}: ${error}`);
        }
      }

      const projectInfo: ProjectInfo = {
        type: ['npm'],
        dependencyFiles,
        dependencies: allDependencies,
      };

      this.logger.info(`Static scan complete: ${allDependencies.length} total dependencies`);
      return projectInfo;
    } catch (error: unknown) {
      throw this.handleError(error, 'Static scan failed');
    }
  }

  /**
   * Parses a package.json file and extracts dependencies
   */
  async parseDependencyFile(filePath: string, workspaceFolder?: string): Promise<DependencyFile> {
    this.logger.info(`Parsing package.json: ${filePath}`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const packageJson = JSON.parse(content);

      const dependencies: Dependency[] = [];
      const devDependencies: Dependency[] = [];

      // Parse regular dependencies
      if (packageJson.dependencies && typeof packageJson.dependencies === 'object') {
        for (const [name, versionConstraint] of Object.entries(packageJson.dependencies)) {
          if (typeof versionConstraint === 'string') {
            dependencies.push({
              name,
              version: this.extractVersion(versionConstraint),
              versionConstraint,
              isDev: false,
            });
          }
        }
      }

      // Parse dev dependencies
      if (packageJson.devDependencies && typeof packageJson.devDependencies === 'object') {
        for (const [name, versionConstraint] of Object.entries(packageJson.devDependencies)) {
          if (typeof versionConstraint === 'string') {
            devDependencies.push({
              name,
              version: this.extractVersion(versionConstraint),
              versionConstraint,
              isDev: true,
            });
          }
        }
      }

      return {
        path: filePath,
        type: 'npm',
        packageName: typeof packageJson.name === 'string' ? packageJson.name : undefined,
        packageRoot: path.dirname(filePath),
        workspaceFolder,
        dependencies,
        devDependencies,
      };
    } catch (error: unknown) {
      if (this.isNodeError(error) && error.code === 'ENOENT') {
        throw new DepPulseError(`File not found: ${filePath}`, ErrorCode.FILE_NOT_FOUND, true);
      } else if (error instanceof SyntaxError) {
        throw new DepPulseError(
          `Invalid JSON in ${filePath}: ${error.message}`,
          ErrorCode.PARSE_ERROR,
          true
        );
      }
      throw this.handleError(error, `Failed to parse ${filePath}`);
    }
  }

  /**
   * Extracts a clean version number from a version constraint
   */
  private extractVersion(versionConstraint: string): string {
    return versionConstraint.replace(/^[\^~>=<]+/, '').trim();
  }

  private markInternal(dep: Dependency, internalNames: Set<string>): Dependency {
    const isWorkspaceRange = dep.versionConstraint.startsWith('workspace:');
    const isInternalName = internalNames.has(dep.name);
    if (isWorkspaceRange || isInternalName) {
      return { ...dep, isInternal: true, version: dep.version || dep.versionConstraint };
    }
    return dep;
  }

  private handleError(error: unknown, context: string): DepPulseError {
    if (error instanceof DepPulseError) {
      return error;
    }
    let code = ErrorCode.UNKNOWN;
    let recoverable = false;
    let errorMessage = 'Unknown error';

    if (this.isNodeError(error) && error.code === 'ENOENT') {
      code = ErrorCode.FILE_NOT_FOUND;
      recoverable = true;
      errorMessage = error.message;
    } else if (error instanceof SyntaxError) {
      code = ErrorCode.PARSE_ERROR;
      recoverable = true;
      errorMessage = error.message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return new DepPulseError(`${context}: ${errorMessage}`, code, recoverable, {
      originalError: error,
    });
  }

  private async resolveLockfile(
    packageDir: string
  ): Promise<{ type: 'pnpm' | 'yarn' | 'npm'; path: string } | null> {
    let currentDir = packageDir;

    while (true) {
      const pnpmLock = path.join(currentDir, 'pnpm-lock.yaml');
      const yarnLock = path.join(currentDir, 'yarn.lock');
      const npmLock = path.join(currentDir, 'package-lock.json');

      try {
        await fs.access(pnpmLock);
        return { type: 'pnpm', path: pnpmLock };
      } catch {
        // ignore
      }

      try {
        await fs.access(yarnLock);
        return { type: 'yarn', path: yarnLock };
      } catch {
        // ignore
      }

      try {
        await fs.access(npmLock);
        return { type: 'npm', path: npmLock };
      } catch {
        // ignore
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    return null;
  }

  private isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error;
  }
}
