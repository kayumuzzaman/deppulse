import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { ProjectInfo } from '../types';
import { NodeJsScanner } from './NodeJsScanner';

const outputChannelMock = {
  name: 'test',
  append: vi.fn(),
  appendLine: vi.fn(),
  replace: vi.fn(),
  clear: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  dispose: vi.fn(),
};

const workspaceState: {
  folders: { uri: { fsPath: string } }[];
  strategy?: 'auto' | 'native' | 'static';
} = {
  folders: [],
  strategy: 'auto',
};

const watcherMock = {
  onDidCreate: vi.fn(),
  onDidChange: vi.fn(),
  onDidDelete: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('vscode', () => {
  class Disposable {
    private callback?: () => void;

    constructor(callback?: () => void) {
      this.callback = callback;
    }

    dispose(): void {
      this.callback?.();
    }
  }

  class RelativePattern {
    base: unknown;
    pattern: unknown;

    constructor(base: unknown, pattern: unknown) {
      this.base = base;
      this.pattern = pattern;
    }
  }

  const joinPath = (base: { fsPath?: string }, ...paths: string[]) => {
    const root = base.fsPath ?? '';
    const fsPath = path.join(root, ...paths);
    return { fsPath };
  };

  return {
    Disposable,
    RelativePattern,
    window: {
      showWarningMessage: vi.fn(),
      createOutputChannel: vi.fn(() => outputChannelMock),
    },
    Uri: {
      joinPath,
    },
    workspace: {
      get workspaceFolders() {
        return workspaceState.folders;
      },
      createFileSystemWatcher: vi.fn(() => watcherMock),
      fs: {
        stat: vi.fn(),
        readFile: vi.fn(),
      },
      getConfiguration: vi.fn(() => ({
        get: vi.fn((_, defaultValue) => workspaceState.strategy ?? defaultValue),
      })),
    },
  };
});

describe('NodeJsScanner monorepo support', () => {
  const outputChannel = outputChannelMock;

  beforeEach(() => {
    workspaceState.folders = [];
    workspaceState.strategy = 'auto';
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses native first in auto mode for monorepo folders', async () => {
    workspaceState.folders = [{ uri: { fsPath: '/repo' } }];

    const scanner = new NodeJsScanner(outputChannel as unknown as vscode.OutputChannel);
    type ScannerTestHarness = {
      staticScanner: { scan: (dir: string) => Promise<ProjectInfo> };
      nativeScanner: { scan: (dir: string) => Promise<ProjectInfo> };
    };
    const scannerAny = scanner as unknown as ScannerTestHarness;

    const staticScan = vi.spyOn(scannerAny.staticScanner, 'scan').mockResolvedValue({
      type: ['npm'],
      dependencyFiles: [
        {
          path: '/repo/package.json',
          type: 'npm',
          workspaceFolder: '/repo',
          dependencies: [],
          devDependencies: [],
        },
      ],
      dependencies: [],
    });

    const nativeScan = vi.spyOn(scannerAny.nativeScanner, 'scan').mockResolvedValue({
      type: ['npm'],
      dependencyFiles: [
        { path: '/repo/package.json', type: 'npm', dependencies: [], workspaceFolder: '/repo' },
      ],
      dependencies: [],
    });

    const result = await scanner.scanWorkspace();

    expect(nativeScan).toHaveBeenCalledTimes(1);
    expect(staticScan).toHaveBeenCalledTimes(0);
    expect(result.dependencyFiles[0]?.workspaceFolder).toBe('/repo');
  });

  it('merges results across workspace folders and preserves workspace metadata', async () => {
    workspaceState.folders = [{ uri: { fsPath: '/repo1' } }, { uri: { fsPath: '/repo2' } }];

    const scanner = new NodeJsScanner(outputChannel as unknown as vscode.OutputChannel);
    type ScannerTestHarness = {
      staticScanner: { scan: (dir: string) => Promise<ProjectInfo> };
      nativeScanner: { scan: (dir: string) => Promise<ProjectInfo> };
    };
    const scannerAny = scanner as unknown as ScannerTestHarness;

    const nativeScan = vi
      .spyOn(scannerAny.nativeScanner, 'scan')
      .mockResolvedValueOnce({
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/repo1/package.json',
            type: 'npm',
            dependencies: [
              { name: 'pkg-a', version: '1.0.0', versionConstraint: '^1.0.0', isDev: false },
            ],
            workspaceFolder: '/repo1',
          },
        ],
        dependencies: [
          { name: 'pkg-a', version: '1.0.0', versionConstraint: '^1.0.0', isDev: false },
        ],
      })
      .mockResolvedValueOnce({
        type: ['npm'],
        dependencyFiles: [
          {
            path: '/repo2/package.json',
            type: 'npm',
            dependencies: [
              { name: 'pkg-b', version: '2.0.0', versionConstraint: '^2.0.0', isDev: false },
            ],
            workspaceFolder: '/repo2',
          },
        ],
        dependencies: [
          { name: 'pkg-b', version: '2.0.0', versionConstraint: '^2.0.0', isDev: false },
        ],
      });

    const result = await scanner.scanWorkspace();

    expect(nativeScan).toHaveBeenCalledTimes(2);
    expect(result.dependencyFiles).toHaveLength(2);
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencyFiles.map((file) => file.workspaceFolder)).toEqual([
      '/repo1',
      '/repo2',
    ]);
    expect(result.type).toEqual(['npm']);
  });

  it('falls back to static when native fails in auto mode', async () => {
    workspaceState.folders = [{ uri: { fsPath: '/repo' } }];

    const scanner = new NodeJsScanner(outputChannel as unknown as vscode.OutputChannel);
    type ScannerTestHarness = {
      staticScanner: { scan: (dir: string) => Promise<ProjectInfo> };
      nativeScanner: { scan: (dir: string) => Promise<ProjectInfo> };
    };
    const scannerAny = scanner as unknown as ScannerTestHarness;

    const staticScan = vi.spyOn(scannerAny.staticScanner, 'scan').mockResolvedValue({
      type: ['npm'],
      dependencyFiles: [
        { path: '/repo/package.json', type: 'npm', dependencies: [], devDependencies: [] },
      ],
      dependencies: [],
    });

    const nativeScan = vi
      .spyOn(scannerAny.nativeScanner, 'scan')
      .mockRejectedValue(new Error('fail'));

    await scanner.scanWorkspace();

    expect(nativeScan).toHaveBeenCalledTimes(1);
    expect(staticScan).toHaveBeenCalledTimes(1);
  });

  it('watches lockfiles as well as package.json', () => {
    const scanner = new NodeJsScanner(outputChannel as unknown as vscode.OutputChannel);

    scanner.watchForChanges(() => {});

    expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
      '**/{package.json,package-lock.json,pnpm-lock.yaml,yarn.lock}'
    );
  });

  it('does not label generic native-scan failures as network issues', async () => {
    workspaceState.folders = [{ uri: { fsPath: '/repo' } }];

    const scanner = new NodeJsScanner(outputChannel as unknown as vscode.OutputChannel);
    type ScannerTestHarness = {
      staticScanner: { scan: (dir: string) => Promise<ProjectInfo> };
      nativeScanner: { scan: (dir: string) => Promise<ProjectInfo> };
    };
    const scannerAny = scanner as unknown as ScannerTestHarness;

    vi.spyOn(scannerAny.staticScanner, 'scan').mockResolvedValue({
      type: ['npm'],
      dependencyFiles: [],
      dependencies: [],
    });
    vi.spyOn(scannerAny.nativeScanner, 'scan').mockRejectedValue(
      new Error('Native scan reported network mode mismatch')
    );

    await scanner.scanWorkspace();

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'DepPulse could not run the native dependency scan (missing lockfile, CLI, or installed node_modules). Using static scan instead (direct dependencies only). Check the DepPulse output for details.'
    );
  });
});
