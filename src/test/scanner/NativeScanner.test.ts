import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeScanner } from '../../scanner/strategies/NativeScanner';
import type { Dependency } from '../../types';

// Mock fs
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: vi.fn(),
    readFile: vi.fn(),
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
      findFiles: vi.fn().mockResolvedValue([{ fsPath: '/test/dir/package.json' }]),
    },
  };
});

// Mock Logger
vi.mock('../../utils/Logger', () => {
  return {
    Logger: {
      getInstance: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        log: vi.fn(),
      }),
    },
  };
});

const { executeToFileMock } = vi.hoisted(() => ({
  executeToFileMock: vi.fn(),
}));

vi.mock('../../utils/StreamedCommandExecutor', () => ({
  StreamedCommandExecutor: {
    getInstance: () => ({
      executeToFile: executeToFileMock,
    }),
  },
}));

const writeTempJson = async (data: unknown) => {
  const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const filePath = path.join(os.tmpdir(), `dep-pulse-native-${Math.random()}.json`);
  await actualFs.writeFile(filePath, JSON.stringify(data));
  return filePath;
};

describe('NativeScanner Tests', () => {
  let scanner: NativeScanner;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Should detect NPM project and parse output', async () => {
    const filePath = await writeTempJson({
      name: 'test-project',
      version: '1.0.0',
      dependencies: {
        react: { version: '18.2.0', required: '^18.2.0' },
        lodash: { version: '4.17.21' },
      },
    });

    executeToFileMock.mockResolvedValue({
      filePath,
      stderr: '',
    });

    // Mock fs.access to simulate package-lock.json exists
    vi.mocked(fs.access).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.endsWith('package-lock.json')) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('ENOENT'));
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ name: 'root-pkg' }));

    scanner = new NativeScanner();
    const result = await scanner.scan('/test/dir');

    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies[0].name).toBe('react');
    expect(result.dependencies[0].version).toBe('18.2.0');
    expect(result.dependencies[1].name).toBe('lodash');

    expect(executeToFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm', args: expect.arrayContaining(['list']) }),
      '/test/dir'
    );
  });

  it('Should detect PNPM project and parse output', async () => {
    const filePath = await writeTempJson([
      {
        name: 'test-project',
        version: '1.0.0',
        dependencies: {
          react: { version: '18.2.0', from: '^18.2.0' },
        },
        devDependencies: {
          typescript: { version: '5.0.0', from: '^5.0.0' },
        },
      },
    ]);

    executeToFileMock.mockResolvedValue({
      filePath,
      stderr: '',
    });

    vi.mocked(fs.access).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.endsWith('pnpm-lock.yaml')) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('ENOENT'));
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ name: 'root-pkg' }));

    scanner = new NativeScanner();
    const result = await scanner.scan('/test/dir');

    expect(result.dependencies).toHaveLength(2);

    const react = result.dependencies.find((d: Dependency) => d.name === 'react');
    const ts = result.dependencies.find((d: Dependency) => d.name === 'typescript');

    expect(react).toBeDefined();
    expect(react?.version).toBe('18.2.0');
    expect(react?.isDev).toBe(false);

    expect(ts).toBeDefined();
    expect(ts?.version).toBe('5.0.0');
    expect(ts?.isDev).toBe(true);

    expect(executeToFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm', args: expect.arrayContaining(['list']) }),
      '/test/dir'
    );
  });

  it('Should fallback to NPM if no lockfile found', async () => {
    const filePath = await writeTempJson({ dependencies: {} });

    executeToFileMock.mockResolvedValue({
      filePath,
      stderr: '',
    });

    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ name: 'root-pkg' }));

    scanner = new NativeScanner();
    await scanner.scan('/test/dir');

    // Should default to npm command
    expect(executeToFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'npm', args: expect.arrayContaining(['list']) }),
      '/test/dir'
    );
  });

  it('Handles large pnpm output via streaming', async () => {
    const largeDeps: Record<string, { version: string; from: string }> = {};
    for (let i = 0; i < 2000; i++) {
      largeDeps[`pkg-${i}`] = { version: `1.0.${i}`, from: `^1.0.${i}` };
    }

    const filePath = await writeTempJson([
      {
        name: 'big-project',
        version: '1.0.0',
        dependencies: largeDeps,
      },
    ]);

    executeToFileMock.mockResolvedValue({
      filePath,
      stderr: '',
    });

    vi.mocked(fs.access).mockImplementation(async (pathArg) => {
      if (typeof pathArg === 'string' && pathArg.endsWith('pnpm-lock.yaml')) {
        return Promise.resolve();
      }
      return Promise.reject(new Error('ENOENT'));
    });
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({ name: 'root-pkg' }));

    scanner = new NativeScanner();
    const result = await scanner.scan('/test/dir');

    expect(result.dependencies.length).toBeGreaterThanOrEqual(2000);
    expect(executeToFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'pnpm', args: expect.arrayContaining(['list']) }),
      '/test/dir'
    );
  });
});
