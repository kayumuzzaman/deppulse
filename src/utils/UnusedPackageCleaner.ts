import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { DepPulseError, ErrorCode, type ProjectInfo } from '../types';
import { CommandExecutor, type CommandSpec } from './CommandExecutor';
import { Logger } from './Logger';

export type PackageManager = 'npm' | 'pnpm' | 'yarn';

export interface CleanupTarget {
  packageRoot: string;
  packageName?: string;
  workspaceFolder?: string;
  packageManager: PackageManager;
  internalPackageNames?: string[];
  isRootScan?: boolean; // True if this is a root-level scan for monorepos
}

export interface UnusedDependencyReport {
  dependencies: string[];
  devDependencies: string[];
}

export interface KnipIssue {
  file: string;
  dependencies?: Array<{ name: string } | string>;
  devDependencies?: Array<{ name: string } | string>;
}

export interface CleanupPlan {
  target: CleanupTarget;
  report: UnusedDependencyReport;
}

export interface RemovalCommand extends CommandSpec {}

export class UnusedPackageCleaner {
  private readonly logger = Logger.getInstance();

  constructor(
    private readonly executor: Pick<CommandExecutor, 'execute'> = CommandExecutor.getInstance()
  ) {}

  /**
   * Detects if the project is a monorepo based on dependency files.
   */
  private isMonorepo(projectInfo: ProjectInfo): boolean {
    const depFiles = projectInfo.dependencyFiles ?? [];
    if (depFiles.length <= 1) return false;

    // Check if there are multiple package.json files with different roots
    const packageRoots = new Set<string>();
    const workspaceFolders = new Set<string>();

    for (const depFile of depFiles) {
      const packageRoot = depFile.packageRoot ?? path.dirname(depFile.path);
      packageRoots.add(packageRoot);
      if (depFile.workspaceFolder) {
        workspaceFolders.add(depFile.workspaceFolder);
      }
    }

    // Monorepo if: multiple package roots OR multiple workspace folders
    return packageRoots.size > 1 || workspaceFolders.size > 1;
  }

  /**
   * Gets the workspace root for monorepo scanning.
   */
  private getWorkspaceRoot(projectInfo: ProjectInfo): string | undefined {
    const depFiles = projectInfo.dependencyFiles ?? [];
    if (depFiles.length === 0) return undefined;

    // Find the most common workspace folder (root)
    const workspaceFolders = new Map<string, number>();
    for (const depFile of depFiles) {
      if (depFile.workspaceFolder) {
        workspaceFolders.set(
          depFile.workspaceFolder,
          (workspaceFolders.get(depFile.workspaceFolder) ?? 0) + 1
        );
      }
    }

    if (workspaceFolders.size > 0) {
      // Return the most common workspace folder (likely the root)
      let maxCount = 0;
      let rootFolder = '';
      for (const [folder, count] of workspaceFolders.entries()) {
        if (count > maxCount) {
          maxCount = count;
          rootFolder = folder;
        }
      }
      return rootFolder;
    }

    // Fallback: use the first package's directory as root
    const firstDepFile = depFiles[0];
    return firstDepFile.packageRoot ?? path.dirname(firstDepFile.path);
  }

  /**
   * Builds unique cleanup targets from scanned project info.
   * For monorepos: returns a single root target to scan all workspaces at once.
   * For monoliths: returns a single target for the package.
   */
  async buildCleanupTargets(projectInfo: ProjectInfo): Promise<CleanupTarget[]> {
    const internalPackageNames = this.collectInternalPackageNames(projectInfo);
    const isMonorepo = this.isMonorepo(projectInfo);

    if (isMonorepo) {
      // For monorepos, return a single root target
      const workspaceRoot = this.getWorkspaceRoot(projectInfo);
      if (!workspaceRoot) {
        throw new DepPulseError(
          'Cannot determine workspace root for monorepo.',
          ErrorCode.UNKNOWN,
          true
        );
      }

      const packageManager = await this.detectPackageManager(workspaceRoot, workspaceRoot);

      return [
        {
          packageRoot: workspaceRoot,
          workspaceFolder: workspaceRoot,
          packageManager,
          internalPackageNames: Array.from(internalPackageNames),
          isRootScan: true, // Flag to indicate this is a root-level scan
        },
      ];
    }

    // For monoliths, return a single target for the package
    const targets = new Map<string, CleanupTarget>();
    for (const depFile of projectInfo.dependencyFiles ?? []) {
      const packageRoot = depFile.packageRoot ?? path.dirname(depFile.path);
      if (targets.has(packageRoot)) continue;

      const packageManager = await this.detectPackageManager(packageRoot, depFile.workspaceFolder);
      const packageName = depFile.packageName ?? (await this.readPackageName(packageRoot));

      targets.set(packageRoot, {
        packageRoot,
        packageName,
        workspaceFolder: depFile.workspaceFolder,
        packageManager,
        internalPackageNames: Array.from(internalPackageNames),
      });
    }

    return Array.from(targets.values());
  }

  /**
   * Detect the package manager for a given package root, searching upward to the workspace root.
   * Preference order: pnpm > yarn > npm (default).
   */
  async detectPackageManager(
    packageRoot: string,
    workspaceFolder?: string
  ): Promise<PackageManager> {
    const searchDirs = new Set<string>([packageRoot]);

    if (workspaceFolder) {
      searchDirs.add(workspaceFolder);
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      searchDirs.add(folder.uri.fsPath);
    }

    for (const dir of searchDirs) {
      if (await this.fileExists(path.join(dir, 'pnpm-lock.yaml'))) {
        return 'pnpm';
      }
      if (await this.fileExists(path.join(dir, 'yarn.lock'))) {
        return 'yarn';
      }
      if (await this.fileExists(path.join(dir, 'package-lock.json'))) {
        return 'npm';
      }
    }

    // Fallback to packageManager field in package.json if present
    const packageManagerFromPkg = await this.readPackageManagerField(packageRoot);
    if (packageManagerFromPkg) {
      return packageManagerFromPkg;
    }

    return 'npm';
  }

  /**
   * Build the knip invocation for the chosen package manager.
   * JSON reporter is used to keep stdout parseable.
   */
  buildKnipCommand(manager: PackageManager): CommandSpec {
    if (manager === 'pnpm') {
      return {
        command: 'pnpm',
        args: ['dlx', 'knip', '--dependencies', '--reporter', 'json'],
      };
    }
    if (manager === 'yarn') {
      return {
        command: 'yarn',
        args: ['dlx', 'knip', '--dependencies', '--reporter', 'json'],
      };
    }
    return {
      command: 'npx',
      args: ['--yes', 'knip', '--dependencies', '--reporter', 'json'],
    };
  }

  /**
   * Run knip for a target and parse unused dependency results.
   * For root scans (monorepos), returns a map of package paths to reports.
   * For regular scans (monoliths), returns a single report.
   */
  async findUnusedDependencies(
    target: CleanupTarget,
    projectInfo?: ProjectInfo
  ): Promise<UnusedDependencyReport | Map<string, UnusedDependencyReport>> {
    const command = this.buildKnipCommand(target.packageManager);
    const scanType = target.isRootScan ? 'root (all workspaces)' : 'package';
    this.logger.info(
      `Running knip for ${target.packageRoot} (${scanType}) using ${target.packageManager} (${command.command} ${(command.args ?? []).join(' ')})`
    );

    try {
      const { stdout } = await this.executor.execute(command, target.packageRoot, 120_000);

      if (target.isRootScan && projectInfo) {
        // For root scans, parse with file mapping
        const fileMap = this.parseKnipOutputWithFileMapping(stdout);
        const mappedReports = this.mapFilePathsToPackages(fileMap, projectInfo, target);
        this.logger.info(
          `Knip detected unused dependencies across ${mappedReports.size} package(s) from root scan`
        );
        return mappedReports;
      } else {
        // For regular scans, parse normally
        const parsed = this.parseKnipOutput(stdout);
        const report = this.filterInternalDependencies(target, parsed);
        this.logger.info(
          `Knip detected ${
            report.dependencies.length + report.devDependencies.length
          } unused dependencies in ${target.packageRoot}`
        );
        return report;
      }
    } catch (error) {
      // Knip exits with non-zero when unused files/deps are found. Try to parse stdout/stderr anyway.
      const depError = error as
        | (Error & { context?: { stdout?: string; stderr?: string } })
        | undefined;
      const stdout = depError?.context?.stdout;
      const stderr = depError?.context?.stderr;

      const candidate = stdout || stderr;
      if (candidate) {
        try {
          if (target.isRootScan && projectInfo) {
            const fileMap = this.parseKnipOutputWithFileMapping(candidate);
            const mappedReports = this.mapFilePathsToPackages(fileMap, projectInfo, target);
            this.logger.warn(
              `Knip reported findings with non-zero exit; parsed output successfully for root scan`
            );
            return mappedReports;
          } else {
            const parsed = this.parseKnipOutput(candidate);
            const report = this.filterInternalDependencies(target, parsed);
            this.logger.warn(
              `Knip reported findings with non-zero exit; parsed output successfully for ${target.packageRoot}`
            );
            return report;
          }
        } catch {
          // fall through to rethrow original error
        }
      }
      throw error;
    }
  }

  /**
   * Maps file paths from knip output to package roots.
   */
  private mapFilePathsToPackages(
    fileMap: Map<string, UnusedDependencyReport>,
    projectInfo: ProjectInfo,
    rootTarget: CleanupTarget
  ): Map<string, UnusedDependencyReport> {
    const result = new Map<string, UnusedDependencyReport>();
    const depFiles = projectInfo.dependencyFiles ?? [];

    // Create a map of package.json paths to package roots
    const pathToRoot = new Map<string, string>();
    for (const depFile of depFiles) {
      const packageRoot = depFile.packageRoot ?? path.dirname(depFile.path);
      const packageJsonPath = depFile.path;
      pathToRoot.set(packageJsonPath, packageRoot);

      // Also map relative paths (e.g., "packages/ui/package.json")
      if (rootTarget.workspaceFolder) {
        const relativePath = path.relative(rootTarget.workspaceFolder, packageJsonPath);
        pathToRoot.set(relativePath, packageRoot);
        // Normalize separators for cross-platform compatibility
        const normalizedRelative = relativePath.replace(/\\/g, '/');
        pathToRoot.set(normalizedRelative, packageRoot);
      }
    }

    // Map each file path to its package root
    for (const [filePath, report] of fileMap.entries()) {
      // Try to find matching package root
      let packageRoot: string | undefined;

      // Try exact match first
      packageRoot = pathToRoot.get(filePath);

      // Try relative path match
      if (!packageRoot && rootTarget.workspaceFolder) {
        const normalized = filePath.replace(/\\/g, '/');
        packageRoot = pathToRoot.get(normalized);
      }

      // Try resolving relative to workspace root
      if (!packageRoot && rootTarget.workspaceFolder) {
        try {
          const resolvedPath = path.resolve(rootTarget.workspaceFolder, filePath);
          packageRoot = pathToRoot.get(resolvedPath);
        } catch {
          // Ignore path resolution errors
        }
      }

      // Fallback: try to find by matching the directory structure
      if (!packageRoot) {
        for (const [knownPath, root] of pathToRoot.entries()) {
          if (knownPath.endsWith(filePath) || filePath.endsWith(knownPath)) {
            packageRoot = root;
            break;
          }
        }
      }

      if (packageRoot) {
        // Filter internal dependencies for this package
        const target: CleanupTarget = {
          ...rootTarget,
          packageRoot,
        };
        const filteredReport = this.filterInternalDependencies(target, report);
        if (filteredReport.dependencies.length > 0 || filteredReport.devDependencies.length > 0) {
          result.set(packageRoot, filteredReport);
        }
      } else {
        this.logger.warn(`Could not map knip file path to package root: ${filePath}`);
      }
    }

    return result;
  }

  /**
   * Parse knip JSON output with file mapping for monorepos.
   * Returns a map of package paths to their unused dependencies.
   */
  public parseKnipOutputWithFileMapping(output: string): Map<string, UnusedDependencyReport> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output.trim());
    } catch (error) {
      throw new DepPulseError(
        'Failed to parse knip output as JSON. See DepPulse output for details.',
        ErrorCode.PARSE_ERROR,
        true,
        { originalError: error }
      );
    }

    const result = new Map<string, UnusedDependencyReport>();
    const asRecord = parsed as Record<string, unknown>;
    const issues = asRecord.issues;

    if (Array.isArray(issues)) {
      for (const issue of issues) {
        if (!issue || typeof issue !== 'object') continue;

        const record = issue as KnipIssue;
        const filePath = record.file;
        if (!filePath || typeof filePath !== 'string') continue;

        // Only process package.json files
        if (!filePath.endsWith('package.json')) continue;

        const deps = new Set<string>();
        const devDeps = new Set<string>();

        this.collectDependencies(record.dependencies, deps);
        this.collectDependencies(record.devDependencies, devDeps);

        if (deps.size > 0 || devDeps.size > 0) {
          result.set(filePath, {
            dependencies: Array.from(deps).sort(),
            devDependencies: Array.from(devDeps).sort(),
          });
        }
      }
    }

    return result;
  }

  /**
   * Helper to collect dependency names from various formats.
   */
  private collectDependencies(value: unknown, bucket: Set<string>): void {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          bucket.add(item);
        } else if (item && typeof item === 'object' && 'name' in item) {
          const name = (item as { name?: unknown }).name;
          if (typeof name === 'string') bucket.add(name);
        }
      }
    }
  }

  /**
   * Parse knip JSON output and extract unused dependencies.
   * Supports both classic and reporter JSON shapes.
   */
  parseKnipOutput(output: string): UnusedDependencyReport {
    let parsed: unknown;
    try {
      parsed = JSON.parse(output.trim());
    } catch (error) {
      throw new DepPulseError(
        'Failed to parse knip output as JSON. See DepPulse output for details.',
        ErrorCode.PARSE_ERROR,
        true,
        { originalError: error }
      );
    }

    const deps = new Set<string>();
    const devDeps = new Set<string>();

    const asRecord = parsed as Record<string, unknown>;

    // Shape: { issues: [ { dependencies: [...], devDependencies: [...] } ] }
    const issues = asRecord.issues;
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        if (issue && typeof issue === 'object') {
          const record = issue as Record<string, unknown>;
          this.collectDependencies(record.dependencies, deps);
          this.collectDependencies(record.devDependencies, devDeps);
        }
      }
    } else if (issues && typeof issues === 'object') {
      // Shape: { issues: { dependencies: { unused: [...] }, devDependencies: { unused: [...] } } }
      const record = issues as Record<string, unknown>;
      if (record.dependencies && typeof record.dependencies === 'object') {
        this.collectDependencies((record.dependencies as Record<string, unknown>).unused, deps);
      }
      if (record.devDependencies && typeof record.devDependencies === 'object') {
        this.collectDependencies(
          (record.devDependencies as Record<string, unknown>).unused,
          devDeps
        );
      }
    }

    // Additional fallbacks for other reporter formats
    this.collectDependencies(asRecord.dependencies, deps);
    this.collectDependencies(asRecord.devDependencies, devDeps);
    this.collectDependencies(asRecord.unusedDependencies, deps);
    this.collectDependencies(asRecord.unusedDevDependencies, devDeps);

    // Ensure no duplicates (Sets already handle this, but being explicit)
    return {
      dependencies: Array.from(deps).sort(),
      devDependencies: Array.from(devDeps).sort(),
    };
  }

  /**
   * Remove internal/workspace packages from the unused list so we don't ask
   * users to uninstall their own workspace libraries.
   */
  private filterInternalDependencies(
    target: CleanupTarget,
    report: UnusedDependencyReport
  ): UnusedDependencyReport {
    if (!target.internalPackageNames || target.internalPackageNames.length === 0) {
      return report;
    }

    const internal = new Set(target.internalPackageNames);
    const filteredDeps = report.dependencies.filter((name) => !internal.has(name));
    const filteredDevDeps = report.devDependencies.filter((name) => !internal.has(name));

    const skipped =
      report.dependencies.length +
      report.devDependencies.length -
      filteredDeps.length -
      filteredDevDeps.length;
    if (skipped > 0) {
      this.logger.info(
        `Skipping ${skipped} internal dependency${skipped === 1 ? '' : 'ies'} for ${target.packageRoot}`
      );
    }

    return {
      dependencies: filteredDeps,
      devDependencies: filteredDevDeps,
    };
  }

  /**
   * Build removal commands per target and report.
   */
  buildRemovalCommands(target: CleanupTarget, report: UnusedDependencyReport): RemovalCommand[] {
    const commands: RemovalCommand[] = [];
    const uniqueDeps = Array.from(new Set(report.dependencies));
    const uniqueDevDeps = Array.from(new Set(report.devDependencies));

    if (uniqueDeps.length > 0) {
      if (target.packageManager === 'pnpm') {
        commands.push({ command: 'pnpm', args: ['remove', ...uniqueDeps] });
      } else if (target.packageManager === 'yarn') {
        commands.push({ command: 'yarn', args: ['remove', ...uniqueDeps] });
      } else {
        commands.push({ command: 'npm', args: ['uninstall', ...uniqueDeps] });
      }
    }

    if (uniqueDevDeps.length > 0) {
      if (target.packageManager === 'pnpm') {
        commands.push({ command: 'pnpm', args: ['remove', '-D', ...uniqueDevDeps] });
      } else if (target.packageManager === 'yarn') {
        commands.push({ command: 'yarn', args: ['remove', ...uniqueDevDeps] });
      } else {
        commands.push({ command: 'npm', args: ['uninstall', '-D', ...uniqueDevDeps] });
      }
    }

    return commands;
  }

  /**
   * Execute a package manager command in the specified working directory.
   */
  async executeCommand(command: RemovalCommand, cwd: string): Promise<void> {
    await this.executor.execute(command, cwd, 120_000);
  }

  /**
   * Helper to describe a target for UI summaries.
   */
  formatTargetLabel(target: CleanupTarget): string {
    const workspaceRelative = target.workspaceFolder
      ? path.relative(target.workspaceFolder, target.packageRoot)
      : undefined;

    // Only include relative path if it's meaningful (not empty or just '.')
    const meaningfulRelative =
      workspaceRelative && workspaceRelative !== '.' && workspaceRelative !== ''
        ? workspaceRelative
        : undefined;

    if (target.packageName && meaningfulRelative) {
      return `${target.packageName} (${meaningfulRelative})`;
    }
    if (target.packageName) return target.packageName;
    if (meaningfulRelative) return meaningfulRelative;
    return target.packageRoot;
  }

  async readPackageName(packageRoot: string): Promise<string | undefined> {
    try {
      const pkgPath = path.join(packageRoot, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf8');
      const parsed = JSON.parse(content) as { name?: string };
      return typeof parsed.name === 'string' ? parsed.name : undefined;
    } catch {
      return undefined;
    }
  }

  private collectInternalPackageNames(projectInfo: ProjectInfo): Set<string> {
    const internal = new Set<string>();

    for (const depFile of projectInfo.dependencyFiles ?? []) {
      if (depFile.packageName) {
        internal.add(depFile.packageName);
      }

      for (const dep of depFile.dependencies ?? []) {
        if (dep.isInternal) {
          internal.add(dep.name);
        }
      }

      for (const dep of depFile.devDependencies ?? []) {
        if (dep.isInternal) {
          internal.add(dep.name);
        }
      }
    }

    return internal;
  }

  private async readPackageManagerField(packageRoot: string): Promise<PackageManager | undefined> {
    try {
      const pkgPath = path.join(packageRoot, 'package.json');
      const content = await fs.readFile(pkgPath, 'utf8');
      const parsed = JSON.parse(content) as { packageManager?: string };
      if (parsed.packageManager && typeof parsed.packageManager === 'string') {
        if (parsed.packageManager.startsWith('pnpm@')) return 'pnpm';
        if (parsed.packageManager.startsWith('yarn@')) return 'yarn';
        if (parsed.packageManager.startsWith('npm@')) return 'npm';
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

export const __test__ = {
  collectFromKnipOutput: (output: string) => new UnusedPackageCleaner().parseKnipOutput(output),
  parseKnipOutputWithFileMapping: (output: string) =>
    new UnusedPackageCleaner().parseKnipOutputWithFileMapping(output),
};
