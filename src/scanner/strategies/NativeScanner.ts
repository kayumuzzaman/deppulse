import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as vscode from 'vscode';
import type { Dependency, DependencyFile, ProjectInfo } from '../../types';
import { DepPulseError, ErrorCode } from '../../types';
import type { CommandSpec } from '../../utils/CommandExecutor';
import { Logger } from '../../utils/Logger';
import { StreamedCommandExecutor } from '../../utils/StreamedCommandExecutor';
import { parseJsonFile, resolveFile } from '../../utils/StreamJson';
import type { ScannerStrategy } from './ScannerStrategy';

interface CliAdapter {
  isSupported(path: string): Promise<boolean>;
  getCommand(): CommandSpec;
  parseFile(filePath: string): Promise<Dependency[]>;
}

interface NpmListOutput {
  dependencies?: Record<string, NpmDependencyInfo>;
}

interface NpmDependencyInfo {
  version?: string;
  required?: string;
  dependencies?: Record<string, NpmDependencyInfo>;
}

class NpmCliAdapter implements CliAdapter {
  async isSupported(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, 'package-lock.json'));
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): CommandSpec {
    return {
      command: 'npm',
      args: ['list', '--all', '--json'],
    };
  }

  async parseFile(filePath: string): Promise<Dependency[]> {
    const json = await parseJsonFile<NpmListOutput>(resolveFile(filePath));
    return this.parseDependencies(json.dependencies);
  }

  private parseDependencies(deps?: Record<string, NpmDependencyInfo>): Dependency[] {
    if (!deps) return [];

    const dependencies: Dependency[] = [];
    for (const [name, info] of Object.entries(deps)) {
      const dep: Dependency = {
        name,
        version: info.version || '0.0.0',
        versionConstraint: info.required || info.version || '*',
        resolvedVersion: info.version,
        isDev: false, // npm list output doesn't easily distinguish dev/prod at root without --dev/--prod flags
        isTransitive: false, // Will be set by caller or context if needed, but here we assume top level is direct?
        // Actually, npm list output structure is nested. Top level keys are direct.
        // Nested keys are transitive.
      };

      if (info.dependencies) {
        dep.children = this.parseDependencies(info.dependencies);
        // Mark children as transitive
        for (const child of dep.children) {
          child.isTransitive = true;
        }
      }

      dependencies.push(dep);
    }
    return dependencies;
  }
}

interface PnpmListOutput {
  dependencies?: Record<string, PnpmDependencyInfo>;
  devDependencies?: Record<string, PnpmDependencyInfo>;
}

interface PnpmDependencyInfo {
  version: string;
  from: string;
  dependencies?: Record<string, PnpmDependencyInfo>;
}

class PnpmCliAdapter implements CliAdapter {
  async isSupported(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, 'pnpm-lock.yaml'));
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): CommandSpec {
    return {
      command: 'pnpm',
      args: ['list', '--json', '--depth', 'Infinity'],
    };
  }

  async parseFile(filePath: string): Promise<Dependency[]> {
    try {
      const json = await parseJsonFile<unknown>(resolveFile(filePath));

      // Log the structure for debugging
      const logger = Logger.getInstance();
      logger.debug(
        `PnpmCliAdapter: Parsing output, type: ${Array.isArray(json) ? 'array' : typeof json}, length: ${
          Array.isArray(json) ? json.length : 'N/A'
        }`
      );

      // pnpm list --json returns an array (one item per project in workspace)
      // But it might also return an object directly for single projects
      const projects = (Array.isArray(json) ? json : [json]) as PnpmListOutput[];

      if (projects.length === 0) {
        logger.warn('PnpmCliAdapter: No projects found in pnpm list output');
        return [];
      }

      const dependencies: Dependency[] = [];

      const processDeps = (
        deps: Record<string, PnpmDependencyInfo> | undefined,
        isDev: boolean
      ): Dependency[] => {
        if (!deps) return [];
        const result: Dependency[] = [];

        for (const [name, info] of Object.entries(deps)) {
          // Skip if info is not an object (pnpm might return version strings directly in some cases)
          if (typeof info !== 'object' || !info || typeof info.version !== 'string') {
            logger.debug(
              `PnpmCliAdapter: Skipping invalid dependency entry: ${name}, info type: ${typeof info}`
            );
            continue;
          }

          const dep: Dependency = {
            name,
            version: info.version,
            versionConstraint: info.from || '*',
            resolvedVersion: info.version,
            isDev,
            isTransitive: false,
          };

          if (info.dependencies) {
            // Recursive call for children
            // Note: pnpm list --json output structure might differ for nested deps depending on version
            // But typically it shows the tree.
            dep.children = processDeps(info.dependencies, isDev);
            for (const child of dep.children) {
              child.isTransitive = true;
            }
          }

          result.push(dep);
        }
        return result;
      };

      for (const project of projects) {
        if (!project) {
          logger.warn('PnpmCliAdapter: Empty project entry in array');
          continue;
        }

        const depsCount = project.dependencies ? Object.keys(project.dependencies).length : 0;
        const devDepsCount = project.devDependencies
          ? Object.keys(project.devDependencies).length
          : 0;
        logger.debug(
          `PnpmCliAdapter: Processing project with ${depsCount} dependencies and ${devDepsCount} devDependencies`
        );

        dependencies.push(...processDeps(project.dependencies, false));
        dependencies.push(...processDeps(project.devDependencies, true));
      }

      logger.debug(`PnpmCliAdapter: Parsed ${dependencies.length} total dependencies`);
      return dependencies;
    } catch (error) {
      const logger = Logger.getInstance();
      logger.error(
        `PnpmCliAdapter: Failed to parse output: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}

class YarnCliAdapter implements CliAdapter {
  async isSupported(dir: string): Promise<boolean> {
    try {
      await fs.access(path.join(dir, 'yarn.lock'));
      return true;
    } catch {
      return false;
    }
  }

  getCommand(): CommandSpec {
    return {
      command: 'yarn',
      args: ['list', '--json'],
    };
  }

  async parseFile(filePath: string): Promise<Dependency[]> {
    // Yarn list --json outputs multiple JSON objects, one per line
    // We need to find the one with type "tree"
    const dependencies: Dependency[] = [];
    const rl = readline.createInterface({
      input: fsSync.createReadStream(resolveFile(filePath)),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);
        if (json.type === 'tree' && json.data && json.data.trees) {
          dependencies.push(...this.parseTrees(json.data.trees));
        }
      } catch {
        // Ignore parse errors for non-JSON lines
      }
    }
    return dependencies;
  }

  private parseTrees(trees: YarnTreeNode[]): Dependency[] {
    const result: Dependency[] = [];
    for (const node of trees) {
      // Node name format: "package@version"
      const match = node.name.match(/^(@?[^@]+)@(.+)$/);
      if (match) {
        const name = match[1];
        const version = match[2];

        const dep: Dependency = {
          name,
          version,
          versionConstraint: version,
          resolvedVersion: version,
          isDev: false, // Yarn list doesn't distinguish dev/prod easily
          isTransitive: false,
        };

        if (node.children && node.children.length > 0) {
          dep.children = this.parseTrees(node.children);
          for (const child of dep.children) {
            child.isTransitive = true;
          }
        }

        result.push(dep);
      }
    }
    return result;
  }
}

interface YarnTreeNode {
  name: string;
  children?: YarnTreeNode[];
  hint?: string;
  color?: string;
  depth?: number;
}

type GitignoreRules = {
  dirs: Set<string>;
  files: Set<string>;
  paths: Set<string>;
  globs: Set<string>;
};

const DEFAULT_BUILD_DIR_DENYLIST = new Set<string>([
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

const DEFAULT_GITIGNORE_DIRS = new Set<string>(['node_modules', 'out', 'coverage']);

const DEFAULT_GITIGNORE_FILES = new Set<string>(['.env', '.DS_Store']);
const DEFAULT_GITIGNORE_PATHS = new Set<string>([
  'resources/webview/output.css',
  'resources/webview/chart.js',
]);
const DEFAULT_GITIGNORE_GLOBS = new Set<string>(['*.vsix']);

export class NativeScanner implements ScannerStrategy {
  private logger = Logger.getInstance();
  private executor = StreamedCommandExecutor.getInstance();
  private adapters: CliAdapter[] = [
    new PnpmCliAdapter(), // Check pnpm first (often preferred in monorepos)
    new YarnCliAdapter(),
    new NpmCliAdapter(),
  ];

  private applyWorkspaceContext(
    dep: Dependency,
    packageRoot: string,
    workspaceFolder: string,
    isMonorepo: boolean
  ): Dependency {
    if (!isMonorepo) {
      return dep;
    }
    const enriched: Dependency = {
      ...dep,
      packageRoot,
      workspaceFolder,
    };
    if (dep.children) {
      enriched.children = dep.children.map((child) =>
        this.applyWorkspaceContext(child, packageRoot, workspaceFolder, isMonorepo)
      );
    }
    return enriched;
  }

  getName(): string {
    return 'Native (CLI)';
  }

  async scan(dir: string): Promise<ProjectInfo> {
    this.logger.info(`Starting Native Scan in ${dir}`);

    const gitignoreRules = await this.loadGitignore(dir);
    const packageJsonPaths = await this.findPackageJsons(dir, gitignoreRules);
    if (packageJsonPaths.length === 0) {
      this.logger.warn(`No package.json files found under ${dir}`);
      return { type: [], dependencyFiles: [], dependencies: [] };
    }

    const rootPackagePath = path.join(dir, 'package.json');
    const isMonorepo = packageJsonPaths.some((pkgPath) => pkgPath !== rootPackagePath);
    const targets = isMonorepo ? packageJsonPaths : [rootPackagePath];

    const rootLock = await this.detectRootLock(dir);
    const internalNames = await this.collectInternalNames(packageJsonPaths);
    const dependencyFiles: DependencyFile[] = [];
    const allDependencies: Dependency[] = [];

    for (const pkgPath of targets) {
      const packageDir = path.dirname(pkgPath);
      let adapter: CliAdapter | undefined;

      try {
        adapter = await this.selectAdapter(packageDir, rootLock);
        this.logger.info(`Using adapter ${adapter.constructor.name} for ${packageDir}`);

        const command = adapter.getCommand();
        this.logger.debug(
          `Executing command: ${command.command} ${(command.args ?? []).join(' ')} in ${packageDir}`
        );
        const { filePath } = await this.executor.executeToFile(command, packageDir);
        const resolvedFile = resolveFile(filePath);
        const stat = await fs.stat(resolvedFile).catch(() => undefined);
        const outputSize = stat?.size ?? 0;
        this.logger.debug(
          `Command output streamed to ${resolvedFile} (${outputSize} bytes) for ${packageDir}`
        );

        const dependencies = (await adapter.parseFile(resolvedFile)).map((d) =>
          this.applyWorkspaceContext(
            this.markInternalDependency(d, internalNames),
            packageDir,
            dir,
            isMonorepo
          )
        );
        this.logger.info(
          `Native scan (${adapter.constructor.name}) found ${dependencies.length} dependencies for ${pkgPath}`
        );

        if (dependencies.length === 0 && outputSize > 0) {
          this.logger.warn(
            `No dependencies parsed from output (size: ${outputSize}). This might indicate a parsing issue or missing node_modules.`
          );

          // Check if package.json actually has dependencies - if so, this indicates missing node_modules
          // and we should throw an error to trigger fallback to static scanner
          try {
            const pkgContent = await fs.readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(pkgContent);
            const hasDeps =
              (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
              (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);

            if (hasDeps) {
              this.logger.warn(
                `Package.json has dependencies but native scan returned 0. This likely means node_modules is missing or incomplete. Throwing error to trigger static scanner fallback.`
              );
              throw new DepPulseError(
                'Native scan returned 0 dependencies but package.json has dependencies. This indicates missing or incomplete node_modules.',
                ErrorCode.UNKNOWN,
                true, // recoverable - will trigger fallback to static scanner
                { filePath: resolvedFile, pkgPath }
              );
            }
          } catch (checkError) {
            // If it's already a DepPulseError we threw, re-throw it
            if (checkError instanceof DepPulseError) {
              throw checkError;
            }
            // Otherwise, log and continue (package.json might be unreadable)
            this.logger.debug(`Could not check package.json for dependencies: ${checkError}`);
          }
        }

        dependencyFiles.push({
          path: pkgPath,
          type: 'npm',
          packageName: await this.getPackageName(packageDir),
          packageRoot: packageDir,
          workspaceFolder: dir,
          dependencies: dependencies.filter((d) => !d.isDev),
          devDependencies: dependencies.filter((d) => d.isDev),
        });
        allDependencies.push(...dependencies);
      } catch (error: unknown) {
        const contextAdapter = adapter;
        // If the command failed but produced stdout (e.g. npm list with missing peer deps),
        // we might still be able to parse the dependency tree.
        if (
          contextAdapter &&
          error instanceof DepPulseError &&
          error.context?.filePath &&
          typeof error.context.filePath === 'string'
        ) {
          try {
            this.logger.warn(
              `Native scan command failed for ${pkgPath} but produced output. Attempting to parse... Error: ${error.message}`
            );
            const resolvedFile = resolveFile(error.context.filePath);
            const dependencies = (await contextAdapter.parseFile(resolvedFile)).map((d) =>
              this.applyWorkspaceContext(
                this.markInternalDependency(d, internalNames),
                packageDir,
                dir,
                isMonorepo
              )
            );

            const hasInvalidVersions = dependencies.some((d) => d.version === '0.0.0');

            if (dependencies.length > 0 && !hasInvalidVersions) {
              this.logger.info(
                `Successfully parsed ${dependencies.length} dependencies from failed command output for ${pkgPath}`
              );
              dependencyFiles.push({
                path: pkgPath,
                type: 'npm',
                packageName: await this.getPackageName(packageDir),
                packageRoot: packageDir,
                workspaceFolder: dir,
                dependencies: dependencies.filter((d) => !d.isDev),
                devDependencies: dependencies.filter((d) => d.isDev),
              });
              allDependencies.push(...dependencies);
              continue;
            } else if (hasInvalidVersions) {
              this.logger.warn(
                `Parsed dependencies contain invalid versions (0.0.0) for ${pkgPath}. Falling back to static scan.`
              );
            }
          } catch (parseError) {
            this.logger.error(
              `Failed to parse output from failed command for ${pkgPath}: ${parseError}`
            );
          }
        }

        this.logger.error(`Native scan failed for ${pkgPath}: ${error}`);
        throw error;
      }
    }

    return {
      type: ['npm'], // TODO: Detect project type dynamically
      dependencyFiles,
      dependencies: allDependencies,
    };
  }

  private async selectAdapter(
    dir: string,
    rootLock?: { type: 'pnpm' | 'yarn' | 'npm'; path: string }
  ): Promise<CliAdapter> {
    for (const adapter of this.adapters) {
      if (await adapter.isSupported(dir)) {
        return adapter;
      }
    }

    if (rootLock?.type === 'pnpm') return new PnpmCliAdapter();
    if (rootLock?.type === 'yarn') return new YarnCliAdapter();
    if (rootLock?.type === 'npm') return new NpmCliAdapter();

    return new NpmCliAdapter();
  }

  private async findPackageJsons(dir: string, gitignoreRules: GitignoreRules): Promise<string[]> {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(dir, '**/package.json'),
      '**/node_modules/**'
    );
    const filtered = files
      .map((f) => f.fsPath)
      .filter(
        (fsPath) =>
          fsPath.startsWith(dir) && !this.shouldIgnorePackageJson(fsPath, dir, gitignoreRules)
      );

    const skipped = files.length - filtered.length;
    if (skipped > 0) {
      this.logger.info(`Ignored ${skipped} package.json file(s) due to gitignore/build filters`);
    }

    return filtered;
  }

  private async loadGitignore(workspaceRoot: string): Promise<GitignoreRules> {
    const rules: GitignoreRules = {
      dirs: new Set(DEFAULT_GITIGNORE_DIRS),
      files: new Set(DEFAULT_GITIGNORE_FILES),
      paths: new Set(DEFAULT_GITIGNORE_PATHS),
      globs: new Set(DEFAULT_GITIGNORE_GLOBS),
    };

    try {
      const content = await fs.readFile(path.join(workspaceRoot, '.gitignore'), 'utf-8');
      content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .forEach((line) => {
          const normalized = line.replace(/\\/g, '/');
          if (normalized.endsWith('/')) {
            rules.dirs.add(normalized.slice(0, -1));
          } else if (normalized.includes('/')) {
            rules.paths.add(normalized);
          } else if (normalized.includes('*')) {
            rules.globs.add(normalized);
          } else if (normalized.startsWith('.')) {
            rules.files.add(normalized);
          } else {
            rules.dirs.add(normalized);
          }
        });
    } catch {
      // No .gitignore present; use defaults only
    }

    return rules;
  }

  private matchesGlob(relPath: string, glob: string): boolean {
    // minimal support: "*.ext" suffix match
    if (glob.startsWith('*.')) {
      return relPath.endsWith(glob.slice(1));
    }
    return false;
  }

  private shouldIgnorePackageJson(
    pkgPath: string,
    workspaceRoot: string,
    gitignoreRules: GitignoreRules
  ): boolean {
    const rel = path.relative(workspaceRoot, pkgPath);
    const relPosix = rel.split(path.sep).join('/');
    const segments = relPosix.split('/');

    if (segments.some((segment) => DEFAULT_BUILD_DIR_DENYLIST.has(segment))) {
      return true;
    }

    if (segments.some((segment) => gitignoreRules.dirs.has(segment))) {
      return true;
    }

    if (gitignoreRules.paths.has(relPosix)) {
      return true;
    }

    const filename = segments[segments.length - 1] || '';
    if (gitignoreRules.files.has(filename)) {
      return true;
    }

    for (const glob of gitignoreRules.globs) {
      if (this.matchesGlob(relPosix, glob)) {
        return true;
      }
    }

    return false;
  }

  private async getPackageName(dir: string): Promise<string | undefined> {
    try {
      const pkg = await fs.readFile(path.join(dir, 'package.json'), 'utf-8');
      const parsed = JSON.parse(pkg);
      return typeof parsed.name === 'string' ? parsed.name : undefined;
    } catch {
      return undefined;
    }
  }

  private async detectRootLock(
    dir: string
  ): Promise<{ type: 'pnpm' | 'yarn' | 'npm'; path: string } | undefined> {
    const pnpmLock = path.join(dir, 'pnpm-lock.yaml');
    const pnpmWorkspace = path.join(dir, 'pnpm-workspace.yaml');
    const yarnLock = path.join(dir, 'yarn.lock');
    const npmLock = path.join(dir, 'package-lock.json');

    try {
      await fs.access(pnpmLock);
      return { type: 'pnpm', path: pnpmLock };
    } catch {
      // ignore
    }

    try {
      await fs.access(pnpmWorkspace);
      return { type: 'pnpm', path: pnpmWorkspace };
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

    return undefined;
  }

  private async collectInternalNames(packageJsonPaths: string[]): Promise<Set<string>> {
    const names = new Set<string>();
    for (const pkgPath of packageJsonPaths) {
      try {
        const content = await fs.readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(content);
        if (typeof pkg.name === 'string' && pkg.name.trim().length > 0) {
          names.add(pkg.name);
        }
      } catch (error) {
        this.logger.warn(`Failed to read package name from ${pkgPath}: ${error}`);
      }
    }
    return names;
  }

  private markInternalDependency(dep: Dependency, internalNames: Set<string>): Dependency {
    const constraint = dep.versionConstraint || dep.version || '';
    const isWorkspaceRange =
      constraint.startsWith('workspace:') ||
      constraint.startsWith('link:') ||
      constraint.startsWith('file:');
    const isInternalName = internalNames.has(dep.name);
    const marked: Dependency = {
      ...dep,
      isInternal: dep.isInternal || isInternalName || isWorkspaceRange,
    };
    if (!marked.version && marked.versionConstraint) {
      marked.version = marked.versionConstraint;
    }
    if (dep.children) {
      marked.children = dep.children.map((child) =>
        this.markInternalDependency(child, internalNames)
      );
    }
    return marked;
  }
}
