import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type { ProjectInfo } from '../types';
import { UnusedPackageCleaner } from './UnusedPackageCleaner';

describe('UnusedPackageCleaner', () => {
  let cleaner: UnusedPackageCleaner;
  let outputChannelMock: vscode.LogOutputChannel;

  beforeEach(() => {
    outputChannelMock = {
      name: 'DepPulse',
      append: vi.fn(),
      appendLine: vi.fn(),
      replace: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      logLevel: 0 as unknown as vscode.LogLevel,
      onDidChangeLogLevel: vi.fn() as unknown as vscode.Event<vscode.LogLevel>,
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    vi.spyOn(vscode.window, 'createOutputChannel').mockReturnValue(outputChannelMock);
    cleaner = new UnusedPackageCleaner();
  });

  afterEach(() => {
    (vscode.workspace.workspaceFolders as unknown) = [];
    vi.restoreAllMocks();
  });

  it('builds knip commands per package manager', () => {
    expect(cleaner.buildKnipCommand('npm')).toEqual({
      command: 'npx',
      args: ['--yes', 'knip', '--dependencies', '--reporter', 'json'],
    });
    expect(cleaner.buildKnipCommand('pnpm')).toEqual({
      command: 'pnpm',
      args: ['dlx', 'knip', '--dependencies', '--reporter', 'json'],
    });
    expect(cleaner.buildKnipCommand('yarn')).toEqual({
      command: 'yarn',
      args: ['dlx', 'knip', '--dependencies', '--reporter', 'json'],
    });
  });

  it('parses knip output from issues array', () => {
    const output = JSON.stringify({
      issues: [
        {
          file: 'package.json',
          dependencies: [{ name: 'left-pad' }, { name: 'uuid' }],
          devDependencies: [{ name: 'vitest' }],
        },
      ],
    });

    const result = cleaner.parseKnipOutput(output);
    expect(result.dependencies).toEqual(expect.arrayContaining(['left-pad', 'uuid']));
    expect(result.devDependencies).toEqual(expect.arrayContaining(['vitest']));
  });

  it('parses knip output from reporter object shape', () => {
    const output = JSON.stringify({
      issues: {
        dependencies: { unused: ['axios'] },
        devDependencies: { unused: [{ name: 'ts-node' }] },
      },
    });

    const result = cleaner.parseKnipOutput(output);
    expect(result.dependencies).toEqual(['axios']);
    expect(result.devDependencies).toEqual(['ts-node']);
  });

  it('filters internal packages from knip report', async () => {
    type Executor = {
      execute: (
        command: string,
        cwd: string,
        timeout?: number
      ) => Promise<{
        stdout: string;
        stderr: string;
      }>;
    };

    const mockExecutor: Executor = {
      execute: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          issues: [
            {
              dependencies: [{ name: '@workspace/lib' }, { name: 'lodash' }],
              devDependencies: [{ name: '@workspace/test-utils' }],
            },
          ],
        }),
        stderr: '',
      }),
    };

    const result = await new UnusedPackageCleaner(mockExecutor).findUnusedDependencies({
      packageRoot: '/repo/packages/app',
      packageManager: 'pnpm',
      internalPackageNames: ['@workspace/lib', '@workspace/test-utils'],
    });

    // Should return a single report for non-root scans
    expect(result).not.toBeInstanceOf(Map);
    if (!(result instanceof Map)) {
      expect(result.dependencies).toEqual(['lodash']);
      expect(result.devDependencies).toEqual([]);
    }
    expect(mockExecutor.execute).toHaveBeenCalled();
  });

  it('detects package manager using lockfiles', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dep-pulse-cleaner-'));
    await fs.writeFile(path.join(tempDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    (vscode.workspace.workspaceFolders as unknown) = [
      { uri: { fsPath: tempDir } } as unknown as vscode.WorkspaceFolder,
    ];

    const manager = await cleaner.detectPackageManager(tempDir);
    expect(manager).toBe('pnpm');

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('falls back to packageManager field when no lockfile is found', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dep-pulse-cleaner-'));
    await fs.writeFile(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'demo', packageManager: 'yarn@4.1.0' })
    );
    (vscode.workspace.workspaceFolders as unknown) = [
      { uri: { fsPath: tempDir } } as unknown as vscode.WorkspaceFolder,
    ];

    const manager = await cleaner.detectPackageManager(tempDir);
    expect(manager).toBe('yarn');

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('builds removal commands for dependencies and devDependencies', () => {
    const commands = cleaner.buildRemovalCommands(
      {
        packageRoot: '/tmp/project',
        packageManager: 'pnpm',
      },
      {
        dependencies: ['alpha', 'beta', 'alpha'],
        devDependencies: ['gamma'],
      }
    );

    expect(commands).toEqual([
      { command: 'pnpm', args: ['remove', 'alpha', 'beta'] },
      { command: 'pnpm', args: ['remove', '-D', 'gamma'] },
    ]);
  });

  it('parses knip output with file mapping for monorepos', () => {
    const output = JSON.stringify({
      issues: [
        {
          file: 'packages/ui/package.json',
          dependencies: [{ name: 'react-dom' }],
          devDependencies: [{ name: '@types/react-dom' }],
        },
        {
          file: 'apps/web/package.json',
          dependencies: [{ name: 'lodash' }],
          devDependencies: [],
        },
        {
          file: 'some-other-file.ts',
          dependencies: [],
          devDependencies: [],
        },
      ],
    });

    const result = cleaner.parseKnipOutputWithFileMapping(output);
    expect(result.size).toBe(2);
    expect(result.get('packages/ui/package.json')).toEqual({
      dependencies: ['react-dom'],
      devDependencies: ['@types/react-dom'],
    });
    expect(result.get('apps/web/package.json')).toEqual({
      dependencies: ['lodash'],
      devDependencies: [],
    });
  });

  it('builds single root target for monorepos', async () => {
    const projectInfo: ProjectInfo = {
      type: ['npm'],
      dependencyFiles: [
        {
          path: '/repo/packages/ui/package.json',
          type: 'npm',
          packageName: '@repo/ui',
          packageRoot: '/repo/packages/ui',
          workspaceFolder: '/repo',
          dependencies: [],
          devDependencies: [],
        },
        {
          path: '/repo/apps/web/package.json',
          type: 'npm',
          packageName: 'web',
          packageRoot: '/repo/apps/web',
          workspaceFolder: '/repo',
          dependencies: [],
          devDependencies: [],
        },
      ],
      dependencies: [],
    };

    const targets = await cleaner.buildCleanupTargets(projectInfo);
    expect(targets.length).toBe(1);
    expect(targets[0].isRootScan).toBe(true);
    expect(targets[0].packageRoot).toBe('/repo');
  });

  it('builds single target for monoliths', async () => {
    const projectInfo: ProjectInfo = {
      type: ['npm'],
      dependencyFiles: [
        {
          path: '/repo/package.json',
          type: 'npm',
          packageName: 'my-app',
          packageRoot: '/repo',
          dependencies: [],
          devDependencies: [],
        },
      ],
      dependencies: [],
    };

    const targets = await cleaner.buildCleanupTargets(projectInfo);
    expect(targets.length).toBe(1);
    expect(targets[0].isRootScan).toBeUndefined();
    expect(targets[0].packageRoot).toBe('/repo');
  });
});
