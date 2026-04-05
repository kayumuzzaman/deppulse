import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeScanner } from './NativeScanner';

const { executeToFileMock, findFilesMock, accessMock, readFileMock } = vi.hoisted(() => ({
  executeToFileMock: vi.fn(),
  findFilesMock: vi.fn(),
  accessMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock('../../utils/StreamedCommandExecutor', () => ({
  StreamedCommandExecutor: {
    getInstance: () => ({
      executeToFile: executeToFileMock,
    }),
  },
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: accessMock,
    readFile: readFileMock,
  };
});

vi.mock('vscode', () => {
  class RelativePattern {
    base: unknown;
    pattern: unknown;
    constructor(base: unknown, pattern: unknown) {
      this.base = base;
      this.pattern = pattern;
    }
  }

  return {
    RelativePattern,
    workspace: {
      findFiles: findFilesMock,
    },
    window: {
      createOutputChannel: vi.fn(() => ({
        append: vi.fn(),
        appendLine: vi.fn(),
        replace: vi.fn(),
        clear: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      })),
    },
  };
});

describe('NativeScanner monorepo per-package scanning', () => {
  const scanner = new NativeScanner();

  const writeTempJson = async (data: unknown) => {
    const filePath = path.join(os.tmpdir(), `dep-pulse-monorepo-${Math.random()}.json`);
    await fsp.writeFile(filePath, JSON.stringify(data));
    return filePath;
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs native scan per package.json in a monorepo and aggregates results', async () => {
    findFilesMock.mockResolvedValue([
      { fsPath: '/repo/package.json' },
      { fsPath: '/repo/packages/a/package.json' },
    ]);

    accessMock.mockImplementation(async (target: string | URL | number) => {
      const p = target.toString();
      if (p.endsWith(path.join('repo', 'pnpm-lock.yaml'))) return;
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    });

    readFileMock.mockImplementation(async (target: string | Buffer | URL | number) => {
      const p = target.toString();
      if (p.endsWith('package.json')) {
        return JSON.stringify({ name: path.basename(path.dirname(p)) });
      }
      return '';
    });

    executeToFileMock.mockImplementation(async (_command: unknown, cwd: string) => {
      if (cwd === '/repo') {
        return {
          filePath: await writeTempJson([
            { dependencies: { rootdep: { version: '1.0.0', from: '1.0.0' } } },
          ]),
          stderr: '',
        };
      }
      if (cwd === '/repo/packages/a') {
        return {
          filePath: await writeTempJson([
            { dependencies: { pkgdep: { version: '2.0.0', from: '2.0.0' } } },
          ]),
          stderr: '',
        };
      }
      throw new Error(`Unexpected cwd ${cwd}`);
    });

    const result = await scanner.scan('/repo');

    expect(executeToFileMock).toHaveBeenCalledTimes(2);
    expect(result.dependencyFiles).toHaveLength(2);
    expect(result.dependencies.map((d) => d.name).sort()).toEqual(['pkgdep', 'rootdep']);
    const packageRoots = result.dependencyFiles.map((f) => f.packageRoot).sort();
    expect(packageRoots).toEqual(['/repo', '/repo/packages/a']);
  });

  it('uses root pnpm lock when workspace package lacks a local lock', async () => {
    findFilesMock.mockResolvedValue([
      { fsPath: '/repo/package.json' },
      { fsPath: '/repo/packages/a/package.json' },
    ]);

    accessMock.mockImplementation(async (target: string | URL | number) => {
      const p = target.toString();
      if (p.endsWith(path.join('repo', 'pnpm-lock.yaml'))) return;
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    });

    readFileMock.mockImplementation(async (target: string | Buffer | URL | number) => {
      const p = target.toString();
      if (p.endsWith('package.json')) {
        return JSON.stringify({ name: path.basename(path.dirname(p)) });
      }
      return '';
    });

    executeToFileMock.mockImplementation(async (_command: unknown, cwd: string) => {
      if (cwd === '/repo') {
        return {
          filePath: await writeTempJson([
            { dependencies: { rootdep: { version: '1.0.0', from: '1.0.0' } } },
          ]),
          stderr: '',
        };
      }
      if (cwd === '/repo/packages/a') {
        return {
          filePath: await writeTempJson([
            { dependencies: { pkgdep: { version: '2.0.0', from: '2.0.0' } } },
          ]),
          stderr: '',
        };
      }
      throw new Error(`Unexpected cwd ${cwd}`);
    });

    await scanner.scan('/repo');

    // Should prefer pnpm adapter (root lock) over npm fallback
    expect(executeToFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm', args: expect.arrayContaining(['list']) }),
      '/repo'
    );
    expect(executeToFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm', args: expect.arrayContaining(['list']) }),
      '/repo/packages/a'
    );
  });
});
