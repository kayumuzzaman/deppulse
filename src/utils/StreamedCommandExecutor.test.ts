import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('StreamedCommandExecutor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock('./Logger');
    vi.doUnmock('node:child_process');
    vi.doUnmock('node:fs');
    vi.doUnmock('node:fs/promises');
    vi.doUnmock('node:stream/promises');
    vi.unstubAllGlobals();
  });

  it('uses .cmd shims for known package managers on Windows', async () => {
    const stdoutPipe = vi.fn();
    const stdout = { pipe: stdoutPipe };
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: { pipe: typeof stdoutPipe };
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();

    const spawnMock = vi.fn(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
    const endMock = vi.fn();

    vi.doMock('node:child_process', () => ({
      spawn: spawnMock,
    }));
    vi.doMock('node:fs', () => ({
      createWriteStream: vi.fn(() => ({
        end: endMock,
      })),
    }));
    vi.doMock('node:fs/promises', () => ({
      mkdtemp: vi.fn().mockResolvedValue('/tmp/dep-pulse-test'),
    }));
    vi.doMock('node:stream/promises', () => ({
      finished: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('./Logger', () => ({
      Logger: {
        getInstance: () => ({
          debug: vi.fn(),
        }),
      },
    }));
    vi.stubGlobal('process', { ...process, platform: 'win32' });

    const { StreamedCommandExecutor } = await import('./StreamedCommandExecutor');
    const executor = StreamedCommandExecutor.getInstance();

    await executor.executeToFile({ command: 'yarn', args: ['list'] }, '/tmp/project');

    expect(spawnMock).toHaveBeenCalledWith(
      'yarn.cmd',
      ['list'],
      expect.objectContaining({ cwd: '/tmp/project' })
    );
  });

  it('maps ENOENT spawn failures to command not found', async () => {
    const stdout = { pipe: vi.fn() };
    const stderr = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();

    const spawnMock = vi.fn(() => {
      queueMicrotask(() => {
        const error = new Error('spawn pnpm ENOENT') as Error & { code?: string };
        error.code = 'ENOENT';
        child.emit('error', error);
      });
      return child;
    });

    vi.doMock('node:child_process', () => ({
      spawn: spawnMock,
    }));
    vi.doMock('node:fs', () => ({
      createWriteStream: vi.fn(() => ({
        end: vi.fn(),
      })),
    }));
    vi.doMock('node:fs/promises', () => ({
      mkdtemp: vi.fn().mockResolvedValue('/tmp/dep-pulse-test'),
    }));
    vi.doMock('./Logger', () => ({
      Logger: {
        getInstance: () => ({
          debug: vi.fn(),
        }),
      },
    }));

    const { StreamedCommandExecutor } = await import('./StreamedCommandExecutor');
    const executor = StreamedCommandExecutor.getInstance();

    await expect(
      executor.executeToFile({ command: 'pnpm', args: ['list'] }, '/tmp/project')
    ).rejects.toMatchObject({
      message: expect.stringContaining('Command not found: pnpm list'),
    });
  });
});
