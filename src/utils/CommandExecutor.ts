import * as cp from 'node:child_process';
import * as util from 'node:util';
import { DepPulseError, ErrorCode } from '../types';
import { Logger } from './Logger';

const exec = util.promisify(cp.exec);
const execFile = util.promisify(cp.execFile);

export interface CommandSpec {
  command: string;
  args?: string[];
}

export interface CommandResult {
  stdout: string;
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

export class CommandExecutor {
  private static instance: CommandExecutor;
  private logger = Logger.getInstance();

  private constructor() {}

  public static getInstance(): CommandExecutor {
    if (!CommandExecutor.instance) {
      CommandExecutor.instance = new CommandExecutor();
    }
    return CommandExecutor.instance;
  }

  /**
   * Executes a shell command with timeout and error handling
   * @param command The command to execute
   * @param cwd Current working directory
   * @param timeout Timeout in milliseconds (default: 10000)
   */
  public async execute(
    command: string | CommandSpec,
    cwd: string,
    timeout: number = 10000
  ): Promise<CommandResult> {
    const commandLabel =
      typeof command === 'string' ? command : [command.command, ...(command.args ?? [])].join(' ');
    this.logger.debug(`Executing command: ${commandLabel} in ${cwd}`);

    try {
      const resolvedCommand =
        typeof command === 'string'
          ? command
          : { ...command, command: resolveExecutable(command.command) };
      const options = {
        cwd,
        timeout,
        // Increase buffer to handle large monorepo trees
        maxBuffer: 50 * 1024 * 1024,
      };
      const { stdout, stderr } =
        typeof resolvedCommand === 'string'
          ? await exec(resolvedCommand, options)
          : await execFile(resolvedCommand.command, resolvedCommand.args ?? [], options);

      return { stdout, stderr };
    } catch (error: unknown) {
      // Handle specific error cases
      const err = error as Error & {
        killed?: boolean;
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      if (err.killed) {
        throw new DepPulseError(
          `Command timed out after ${timeout}ms: ${commandLabel}`,
          ErrorCode.UNKNOWN,
          true
        );
      }

      if (err.code === 127 || err.code === 'ENOENT' || err.message.includes('command not found')) {
        throw new DepPulseError(`Command not found: ${commandLabel}`, ErrorCode.UNKNOWN, true);
      }

      // For non-zero exit codes, we might still want the stdout/stderr if available
      // But usually it means failure.
      const stderr = err.stderr?.trim();
      const stdout = err.stdout?.trim();
      const detail = stderr || stdout;
      const combinedMessage = detail
        ? `Command failed: ${commandLabel}. ${detail.slice(0, 500)}`
        : `Command failed: ${commandLabel}. Error: ${err.message}`;

      throw new DepPulseError(combinedMessage, ErrorCode.UNKNOWN, true, {
        stderr,
        stdout,
        code: err.code,
      });
    }
  }
}
