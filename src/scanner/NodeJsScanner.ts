import * as vscode from 'vscode';
import type {
  Dependency,
  DependencyFile,
  FileChange,
  ProjectInfo,
  ProjectType,
  ScanningStrategy,
} from '../types';
import { NetworkStatusService } from '../utils';
import { BaseDependencyScanner } from './DependencyScanner';
import { NativeScanner } from './strategies/NativeScanner';
import type { ScannerStrategy } from './strategies/ScannerStrategy';
import { StaticScanner } from './strategies/StaticScanner';

/**
 * Scanner for Node.js projects (npm/pnpm/yarn via package.json)
 * Acts as a Facade/Context for different scanning strategies
 */
export class NodeJsScanner extends BaseDependencyScanner {
  private nativeScanner: NativeScanner;
  private staticScanner: StaticScanner;

  constructor(outputChannel: vscode.OutputChannel) {
    super(outputChannel);
    this.nativeScanner = new NativeScanner();
    this.staticScanner = new StaticScanner();
  }

  /**
   * Scans the workspace for package.json files using the configured strategy
   */
  async scanWorkspace(): Promise<ProjectInfo> {
    this.log('info', 'Starting Node.js workspace scan');

    // Get configuration
    const config = vscode.workspace.getConfiguration('depPulse.analysis');
    const strategy = config.get<ScanningStrategy>('strategy', 'auto');
    this.log('info', `Scanning strategy: ${strategy}`);

    // Determine which strategy to use
    let activeStrategy: ScannerStrategy;
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.log('warn', 'No workspace folders found');
      return { type: [], dependencyFiles: [], dependencies: [] };
    }

    if (strategy === 'native') {
      activeStrategy = this.nativeScanner;
    } else if (strategy === 'static') {
      activeStrategy = this.staticScanner;
    } else {
      // Auto: Try native, fallback to static
      try {
        // We can check if native is supported without running full scan?
        // For now, let's just try running it. If it fails, we catch and fallback.
        // Or we could check for lockfiles first.
        // NativeScanner handles detection internally, but throws if it fails.
        activeStrategy = this.nativeScanner;
      } catch {
        activeStrategy = this.staticScanner;
      }
    }

    try {
      this.log('info', `Executing strategy: ${activeStrategy.getName()}`);
      const results: ProjectInfo[] = [];

      for (const folder of workspaceFolders) {
        const folderPath = folder.uri.fsPath;
        try {
          results.push(await activeStrategy.scan(folderPath));
        } catch (error) {
          if (strategy === 'auto' && activeStrategy === this.nativeScanner) {
            this.log(
              'warn',
              `Native scan failed for ${folderPath}, falling back to static scan. Error: ${error}`
            );

            // Determine if the error is network-related or missing dependencies
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isNetworkError = NetworkStatusService.isNetworkError(errorMessage);

            const isMissingDependencies =
              errorMessage.includes('ELSPROBLEMS') ||
              errorMessage.includes('missing:') ||
              errorMessage.includes('npm error code ELSPROBLEMS');

            if (isNetworkError) {
              void vscode.window.showWarningMessage(
                'DepPulse: No internet connection. Using static scan (limited functionality). Connect to internet for full analysis.'
              );
            } else if (isMissingDependencies) {
              void vscode.window.showWarningMessage(
                'DepPulse: Some dependencies are not installed (node_modules missing or incomplete). Using static scan instead (direct dependencies only). Run "npm install" or your package manager\'s install command for full dependency tree analysis.'
              );
            } else {
              void vscode.window.showWarningMessage(
                'DepPulse could not run the native dependency scan (missing lockfile, CLI, or installed node_modules). Using static scan instead (direct dependencies only). Check the DepPulse output for details.'
              );
            }

            activeStrategy = this.staticScanner;
            results.push(await activeStrategy.scan(folderPath));
          } else {
            throw error;
          }
        }
      }

      return this.mergeProjectInfo(results);
    } catch (error) {
      throw this.handleError(error, 'Workspace scan failed');
    }
  }

  /**
   * Parses a package.json file and extracts dependencies
   * Delegates to StaticScanner as it has the logic for single file parsing
   */
  async parseDependencyFile(filePath: string): Promise<DependencyFile> {
    return this.staticScanner.parseDependencyFile(filePath);
  }

  /**
   * Watches for changes to package.json files
   */
  watchForChanges(callback: (changes: FileChange[]) => void): vscode.Disposable {
    this.log('info', 'Setting up file watcher for package.json and lockfiles');

    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/{package.json,package-lock.json,pnpm-lock.yaml,yarn.lock}'
    );

    const handleChange = (uri: vscode.Uri, type: 'created' | 'modified' | 'deleted') => {
      // Ignore changes in node_modules
      if (uri.fsPath.includes('node_modules')) {
        return;
      }

      this.log('info', `File ${type}: ${uri.fsPath}`);
      callback([{ type, path: uri.fsPath }]);
    };

    watcher.onDidCreate((uri) => handleChange(uri, 'created'));
    watcher.onDidChange((uri) => handleChange(uri, 'modified'));
    watcher.onDidDelete((uri) => handleChange(uri, 'deleted'));

    return watcher;
  }

  private mergeProjectInfo(results: ProjectInfo[]): ProjectInfo {
    const types = new Set<ProjectType>();
    const dependencyFiles: DependencyFile[] = [];
    const dependencies: Dependency[] = [];

    for (const result of results) {
      for (const t of result.type ?? []) {
        types.add(t);
      }
      if (result.dependencyFiles) {
        dependencyFiles.push(...result.dependencyFiles);
      }
      if (result.dependencies) {
        dependencies.push(...result.dependencies);
      }
    }

    return {
      type: Array.from(types),
      dependencyFiles,
      dependencies,
    };
  }
}
