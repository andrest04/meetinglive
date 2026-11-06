import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import {
  CancelledError,
  CliExitError,
  CliTimeoutError,
  throwIfCancelled,
  type CancelSignal,
  type CliLineRunner,
  type CliProcessRunner,
  type CliRunResult,
} from '@vozella/core';
import { PathCliProbe, type PathCliProbeOptions } from '../settings/path-cli-probe';

/** The error shape the failure classifier maps to NotInstalled (it keeps `code`). */
function notFound(file: string): Error {
  return Object.assign(new Error(`The executable '${file}' was not found.`), { code: 'ENOENT' });
}

/**
 * Arguments for a `.cmd` or `.bat` launch. cmd.exe re-parses its command line, so the list is
 * quoted and anything that could escape the quotes is refused (CVE-2024-27980). The prompt never
 * travels here; it goes on stdin.
 */
export function buildCmdWrapperArgs(script: string, args: readonly string[]): string[] {
  const quote = (value: string): string => {
    if (/[%\r\n\0]/.test(value)) {
      throw new Error('An argument contains a character that cannot be passed through cmd.exe.');
    }
    // A quote inside a quoted argument is doubled; the C runtime reads it back as one quote.
    // Codex needs this for `-c model_reasoning_effort="low"`.
    return `"${value.replace(/"/g, '""')}"`;
  };
  return ['/d', '/s', '/c', `"${[script, ...args].map(quote).join(' ')}"`];
}

interface Launch {
  readonly command: string;
  readonly args: readonly string[];
  readonly verbatim: boolean;
}

function planLaunch(resolved: string, args: readonly string[], windows: boolean): Launch {
  if (windows && /\.(cmd|bat)$/i.test(resolved)) {
    const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe';
    return { command: comspec, args: buildCmdWrapperArgs(resolved, args), verbatim: true };
  }
  return { command: resolved, args, verbatim: false };
}

/** Kills the process and everything it started. Best effort. */
export function killProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      try {
        const killer = spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('error', () => resolve());
        killer.once('close', () => resolve());
      } catch {
        resolve();
      }
    });
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  return Promise.resolve();
}

/** How much stderr `runLines` keeps for a failure: the end, where CLIs print the error. */
const STDERR_TAIL = 8192;

/**
 * True when every byte was handed to the child; a closed pipe is "not delivered", not an error.
 * UTF-8 bytes with no BOM (B24), flushed and then closed.
 */
function writeAllStdin(child: ChildProcess, stdin: string | null): Promise<boolean> {
  return new Promise((resolve) => {
    const pipe = child.stdin;
    if (stdin === null || !pipe) {
      resolve(true);
      return;
    }
    pipe.once('error', () => resolve(false));
    pipe.once('close', () => resolve(false));
    pipe.end(Buffer.from(stdin, 'utf8'), (error?: Error | null) => resolve(!error));
  });
}

/** Splits UTF-8 stdout into lines; a character cut between chunks is kept whole. */
class LineSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private rest = '';

  push(chunk: Buffer): string[] {
    const parts = (this.rest + this.decoder.write(chunk)).split('\n');
    this.rest = parts.pop() ?? '';
    return parts.map((line) => line.replace(/\r$/, ''));
  }

  end(): string[] {
    const last = (this.rest + this.decoder.end()).replace(/\r$/, '');
    this.rest = '';
    return last === '' ? [] : [last];
  }
}

/** Spec 3.7 `CliProcessRunner`, on `child_process.spawn` with `shell: false`. */
export class NodeCliProcessRunner implements CliProcessRunner, CliLineRunner {
  private readonly probe: PathCliProbe;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: PathCliProbeOptions = {}) {
    this.probe = new PathCliProbe(options);
    this.platform = options.platform ?? process.platform;
  }

  isOnPath(executable: string): Promise<boolean> {
    return this.probe.isOnPath(executable);
  }

  resolveExecutable(executable: string): Promise<string | null> {
    return this.probe.resolve(executable);
  }

  /** The one spawn both `run` and `runLines` use: no shell, hidden window, own process group. */
  private async start(
    file: string,
    args: readonly string[],
    stdin: string | null,
    cancel: CancelSignal,
  ): Promise<ChildProcess> {
    throwIfCancelled(cancel);
    const resolved = await this.probe.resolve(file);
    if (resolved === null) throw notFound(file);
    const windows = this.platform === 'win32';
    const launch = planLaunch(resolved, args, windows);
    return spawn(launch.command, [...launch.args], {
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: launch.verbatim,
      detached: !windows,
      env: this.options.env ? { ...process.env, ...this.options.env } : process.env,
      stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * The `CliLineRunner` port: stdout lines as they arrive (CR stripped, blank lines skipped, a last
   * line without a newline included). `timeoutMs` is an idle timeout that restarts on each line.
   * Cancel, timeout, or a consumer that stops early kill the process tree. A non-zero exit ends
   * with `CliExitError` and the last 8 KB of stderr.
   */
  async *runLines(
    file: string,
    args: readonly string[],
    stdin: string | null,
    timeoutMs: number,
    cancel: CancelSignal,
  ): AsyncGenerator<string> {
    const child = await this.start(file, args, stdin, cancel);
    const queue: string[] = [];
    const state = {
      exitCode: null as number | null,
      failure: null as Error | null,
      timedOut: false,
      stderr: '',
    };
    let wake: (() => void) | null = null;
    const notify = (): void => {
      const resume = wake;
      wake = null;
      resume?.();
    };

    let timer = setTimeout(() => undefined, 0);
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.timedOut = true;
        notify();
      }, timeoutMs);
    };
    arm();
    const unsubscribe = cancel.onCancel(notify);

    child.once('error', (error: NodeJS.ErrnoException) => {
      state.failure = error.code === 'ENOENT' || error.code === 'ENOTDIR' ? notFound(file) : error;
      notify();
    });

    const splitter = new LineSplitter();
    const take = (lines: readonly string[]): void => {
      const kept = lines.filter((line) => line.trim() !== '');
      if (kept.length === 0) return;
      queue.push(...kept);
      arm();
      notify();
    };
    child.stdout?.on('data', (chunk: Buffer) => take(splitter.push(chunk)));
    child.stderr?.on('data', (chunk: Buffer) => {
      state.stderr = (state.stderr + chunk.toString('utf8')).slice(-STDERR_TAIL);
    });
    child.once('close', (code) => {
      take(splitter.end());
      state.exitCode = code ?? 1;
      notify();
    });

    const delivered = writeAllStdin(child, stdin);

    try {
      for (;;) {
        if (cancel.cancelled) throw new CancelledError();
        if (state.failure !== null) throw state.failure;
        const line = queue.shift();
        if (line !== undefined) {
          yield line;
          continue;
        }
        if (state.exitCode !== null) break;
        if (state.timedOut) {
          throw new CliTimeoutError(`'${file}' sent nothing for ${String(timeoutMs)} ms.`);
        }
        await new Promise<void>((resolve) => (wake = resolve));
      }
      if (state.exitCode !== 0) throw new CliExitError(file, state.exitCode, state.stderr);
      if (!(await delivered)) throw new Error(`'${file}' exited before reading all of its input.`);
    } finally {
      clearTimeout(timer);
      unsubscribe();
      if (state.exitCode === null) {
        await killProcessTree(child.pid);
        child.kill();
      }
    }
  }

  async run(
    file: string,
    args: readonly string[],
    stdin: string | null,
    timeoutMs: number,
    cancel: CancelSignal,
  ): Promise<CliRunResult> {
    const child = await this.start(file, args, stdin, cancel);

    const spawnFailed = new Promise<never>((_, reject) => {
      child.once('error', (error: NodeJS.ErrnoException) => {
        reject(error.code === 'ENOENT' || error.code === 'ENOTDIR' ? notFound(file) : error);
      });
    });
    spawnFailed.catch(() => undefined);

    const collect = (stream: NodeJS.ReadableStream | null): Promise<string> =>
      new Promise((resolve) => {
        const chunks: Buffer[] = [];
        if (stream === null) {
          resolve('');
          return;
        }
        const done = (): void => resolve(Buffer.concat(chunks).toString('utf8'));
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.once('end', done);
        stream.once('error', done);
        stream.once('close', done);
      });

    const exited = new Promise<number>((resolve) => {
      child.once('close', (code) => resolve(code ?? 1));
    });

    const work = Promise.all([
      collect(child.stdout),
      collect(child.stderr),
      writeAllStdin(child, stdin),
      exited,
    ]);
    work.catch(() => undefined);

    const state = { timedOut: false };
    let abort: () => void = () => undefined;
    const aborted = new Promise<'abort'>((resolve) => {
      abort = () => resolve('abort');
    });
    const timer = setTimeout(() => {
      state.timedOut = true;
      abort();
    }, timeoutMs);
    const unsubscribe = cancel.onCancel(abort);

    try {
      const outcome = await Promise.race([work, aborted, spawnFailed]);
      if (outcome === 'abort') {
        await killProcessTree(child.pid);
        child.kill();
        if (state.timedOut && !cancel.cancelled) {
          throw new CliTimeoutError(`'${file}' did not exit within ${timeoutMs} ms.`);
        }
        throw new CancelledError();
      }
      const [stdout, stderr, delivered, exitCode] = outcome;
      if (!delivered && exitCode === 0) {
        throw new Error(`'${file}' exited before reading all of its input.`);
      }
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
      unsubscribe();
    }
  }
}
