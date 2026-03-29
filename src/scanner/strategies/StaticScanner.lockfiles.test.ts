import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticScanner } from './StaticScanner';

const { findFilesMock, accessMock, readFileMock } = vi.hoisted(() => ({
  findFilesMock: vi.fn(),
  accessMock: vi.fn(),
  readFileMock: vi.fn(),
}));

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

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: accessMock,
    readFile: readFileMock,
  };
});

describe('StaticScanner lockfile handling in monorepos', () => {
  const scanner = new StaticScanner();

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('prefers package-local lockfiles (pnpm, yarn, npm) per package.json', async () => {
    findFilesMock.mockResolvedValue([
      { fsPath: '/repo/packages/pnpm/package.json' },
      { fsPath: '/repo/packages/yarn/package.json' },
      { fsPath: '/repo/packages/npm/package.json' },
    ]);

    const pnpmLock = `
lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      alpha:
        version: 1.0.0
    devDependencies:
      alphadev:
        version: 2.0.0
packages: {}
snapshots: {}
`;

    const yarnLock = `
delta@^1.0.0:
  version "1.1.0"
  dependencies:
    deltachild "^1.0.0"
`;

    const npmLock = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        '': {
          dependencies: { bravo: '^1.0.0' },
          devDependencies: { bravodev: '^2.0.0' },
        },
        'node_modules/bravo': { version: '1.2.3' },
        'node_modules/bravodev': { version: '2.3.4', dev: true },
      },
    });

    accessMock.mockImplementation(async (target: string | URL | number) => {
      const p = target.toString();
      if (p.endsWith(path.join('packages', 'pnpm', 'pnpm-lock.yaml'))) return;
      if (p.endsWith(path.join('packages', 'yarn', 'yarn.lock'))) return;
      if (p.endsWith(path.join('packages', 'npm', 'package-lock.json'))) return;
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    });

    readFileMock.mockImplementation(async (target: string | Buffer | URL | number) => {
      const p = target.toString();
      if (p.endsWith('packages/pnpm/package.json')) {
        return JSON.stringify({ name: 'pnpm-pkg' });
      }
      if (p.endsWith('packages/yarn/package.json')) {
        return JSON.stringify({ name: 'yarn-pkg' });
      }
      if (p.endsWith('packages/npm/package.json')) {
        return JSON.stringify({ name: 'npm-pkg' });
      }
      if (p.endsWith('pnpm-lock.yaml')) return pnpmLock;
      if (p.endsWith('yarn.lock')) return yarnLock;
      if (p.endsWith('package-lock.json')) return npmLock;
      throw new Error(`Unexpected read ${p}`);
    });

    const result = await scanner.scan('/repo');

    expect(result.dependencyFiles).toHaveLength(3);

    const pnpmFile = result.dependencyFiles.find((f) => f.packageRoot?.endsWith('/packages/pnpm'));
    expect(pnpmFile?.dependencies.some((d) => d.name === 'alpha')).toBe(true);
    expect(pnpmFile?.devDependencies?.some((d) => d.name === 'alphadev')).toBe(true);

    const yarnFile = result.dependencyFiles.find((f) => f.packageRoot?.endsWith('/packages/yarn'));
    expect(yarnFile?.dependencies.some((d) => d.name === 'delta')).toBe(true);
    const yarnChildren =
      yarnFile?.dependencies.flatMap((d) => d.children ?? []).map((d) => d.name) ?? [];
    expect(yarnChildren).toContain('deltachild');

    const npmFile = result.dependencyFiles.find((f) => f.packageRoot?.endsWith('/packages/npm'));
    expect(npmFile?.dependencies.some((d) => d.name === 'bravo' && d.version === '1.2.3')).toBe(
      true
    );
    expect(
      npmFile?.devDependencies?.some((d) => d.name === 'bravodev' && d.version === '2.3.4')
    ).toBe(true);
  });

  it('uses a workspace-root pnpm lockfile for nested packages', async () => {
    findFilesMock.mockResolvedValue([{ fsPath: '/repo/packages/app/package.json' }]);

    const pnpmLock = `
lockfileVersion: '9.0'
importers:
  packages/app:
    dependencies:
      shared-dep:
        specifier: ^1.0.0
        version: 1.2.3
packages: {}
snapshots:
  shared-dep@1.2.3: {}
`;

    accessMock.mockImplementation(async (target: string | URL | number) => {
      const p = target.toString();
      if (p.endsWith(path.join('/repo', 'pnpm-lock.yaml'))) return;
      const err = new Error('ENOENT');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    });

    readFileMock.mockImplementation(async (target: string | Buffer | URL | number) => {
      const p = target.toString();
      if (p.endsWith('packages/app/package.json')) {
        return JSON.stringify({ name: 'app-pkg' });
      }
      if (p.endsWith('/repo/pnpm-lock.yaml')) {
        return pnpmLock;
      }
      throw new Error(`Unexpected read ${p}`);
    });

    const result = await scanner.scan('/repo');

    expect(result.dependencyFiles).toHaveLength(1);
    expect(result.dependencyFiles[0]?.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'shared-dep', version: '1.2.3' })])
    );
  });
});
