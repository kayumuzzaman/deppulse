import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { finished } from 'node:stream/promises';
import { DepPulseError, ErrorCode } from '../types';
import type { CommandSpec } from './CommandExecutor';
import { Logger } from './Logger';

export interface StreamedCommandResult {
  filePath: string;
  stderr: string;
}

function resolveExecutable(command: string): string {
  if (process.platform !== 'win32') {
    return command;
  }

  switch (command.toLowerCase()) {
    case 'npm':
    case 'npx':
    case 'pnpm':
    case 'yarn':
      return `${command}.cmd`;
    default:
      return command;
  }
}

/**
 * Executes commands with streamed stdout to avoid buffer limits.
 */
export class StreamedCommandExecutor {
  private static instance: StreamedCommandExecutor;
  private logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): StreamedCommandExecutor {
    if (!StreamedCommandExecutor.instance) {
      StreamedCommandExecutor.instance = new StreamedCommandExecutor();
    }
    return StreamedCommandExecutor.instance;
  }

  /**
   * Run a command, streaming stdout to a temp file to avoid maxBuffer truncation.
   * Returns the temp file path for downstream parsing.
   */
  public async executeToFile(
    command: CommandSpec,
    cwd: string,
    timeout: number = 20000
  ): Promise<StreamedCommandResult> {
    const resolvedCommand = {
      ...command,
      command: resolveExecutable(command.command),
    };
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dep-pulse-'));
    const filePath = path.join(tempDir, 'stdout.json');
    const stdoutStream = fs.createWriteStream(filePath);

    const commandLabel = [command.command, ...(command.args ?? [])].join(' ');
    this.logger.debug(`Streaming command: ${commandLabel} in ${cwd} to ${filePath}`);

    return new Promise<StreamedCommandResult>((resolve, reject) => {
      const child = spawn(resolvedCommand.command, resolvedCommand.args ?? [], {
        cwd,
      });

      let stderr = '';
      let finishedStream = false;
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
      }, timeout);

      child.stdout?.pipe(stdoutStream);
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      const fail = (message: string, context?: Record<string, unknown>) => {
        clearTimeout(timer);
        if (!finishedStream) {
          stdoutStream.end();
        }
        reject(
          new DepPulseError(message, ErrorCode.UNKNOWN, true, {
            stderr,
            filePath,
            ...(context ?? {}),
          })
        );
      };

      child.on('error', (err) => {
        const code = err && typeof err === 'object' && 'code' in err ? err.code : undefined;
        if (code === 'ENOENT') {
          fail(`Command not found: ${commandLabel}`, { code });
          return;
        }
        fail(`Command error: ${commandLabel}. ${err instanceof Error ? err.message : String(err)}`);
      });

      child.on('close', async (code) => {
        clearTimeout(timer);
        try {
          await finished(stdoutStream);
          finishedStream = true;
        } catch (streamErr) {
          return fail(
            `Failed to finalize stdout stream for ${commandLabel}: ${
              streamErr instanceof Error ? streamErr.message : String(streamErr)
            }`
          );
        }

        if (code !== 0) {
          return fail(`Command failed: ${commandLabel}`, { code });
        }

        resolve({ filePath, stderr });
      });
    });
  }
}
