import { afterEach, describe, expect, it, vi } from 'vitest';

describe('CommandExecutor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./Logger');
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:util');
    vi.unstubAllGlobals();
  });

  it('is defined and returns a singleton instance', async () => {
    const { CommandExecutor } = await import('./CommandExecutor');
    const first = CommandExecutor.getInstance();
    const second = CommandExecutor.getInstance();
    expect(first).toBeInstanceOf(CommandExecutor);
    expect(second).toBe(first);
  });

  it('treats ENOENT from execFile as command not found', async () => {
    const execFileMock = vi.fn((_file, _args, _options, callback) => {
      const error = new Error('spawn pnpm ENOENT') as Error & { code?: string };
      error.code = 'ENOENT';
      callback(error);
    });

    vi.doMock('node:child_process', () => ({
      exec: vi.fn(),
      execFile: execFileMock,
    }));
    vi.doMock('node:util', () => ({
      promisify:
        (fn: (...args: unknown[]) => void) =>
        (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            fn(...args, (error: unknown, stdout: string = '', stderr: string = '') => {
              if (error) {
                reject(error);
              } else {
                resolve({ stdout, stderr });
              }
            });
          }),
    }));
    vi.doMock('./Logger', () => ({
      Logger: {
        getInstance: () => ({
          debug: vi.fn(),
        }),
      },
    }));

    const { CommandExecutor } = await import('./CommandExecutor');
    const executor = CommandExecutor.getInstance();

    await expect(
      executor.execute({ command: 'pnpm', args: ['list'] }, '/tmp/project')
    ).rejects.toMatchObject({
      message: expect.stringContaining('Command not found: pnpm list'),
    });
  });

  it('uses .cmd shims for known package managers on Windows', async () => {
    const execFileMock = vi.fn((_file, _args, _options, callback) => {
      callback(null, '{"ok":true}', '');
    });

    vi.doMock('node:child_process', () => ({
      exec: vi.fn(),
      execFile: execFileMock,
    }));
    vi.doMock('node:util', () => ({
      promisify:
        (fn: (...args: unknown[]) => void) =>
        (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            fn(...args, (error: unknown, stdout: string = '', stderr: string = '') => {
              if (error) {
                reject(error);
              } else {
                resolve({ stdout, stderr });
              }
            });
          }),
    }));
    vi.doMock('./Logger', () => ({
      Logger: {
        getInstance: () => ({
          debug: vi.fn(),
        }),
      },
    }));
    vi.stubGlobal('process', { ...process, platform: 'win32' });

    const { CommandExecutor } = await import('./CommandExecutor');
    const executor = CommandExecutor.getInstance();

    await executor.execute({ command: 'pnpm', args: ['list'] }, '/tmp/project');

    expect(execFileMock).toHaveBeenCalledWith(
      'pnpm.cmd',
      ['list'],
      expect.objectContaining({ cwd: '/tmp/project' }),
      expect.any(Function)
    );
  });
});
