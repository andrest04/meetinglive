import { spawn, type ChildProcess } from 'node:child_process';

/** Puts a process under the OS so it dies with this one. The real one is a Windows Job Object. */
export interface ProcessJobPort {
  /** Throws when the process cannot be assigned. */
  assign(pid: number): void;
}

/** Keeps a child alive only as long as this process lives. */
export interface ProcessGuard {
  /** Starts protecting `pid`. Call right after spawn. */
  protect(pid: number): ProtectedProcess;
}

export interface ProtectedProcess {
  readonly mechanism: 'job' | 'watchdog';
  /** Ends the protection, for a child that already exited. Never kills the child. */
  release(): void;
}

/**
 * The watchdog helper: polls the parent and the child, and kills the child's tree once the
 * parent is gone. Plain JavaScript so it runs under node and under Electron with
 * ELECTRON_RUN_AS_NODE.
 */
export const WATCHDOG_SCRIPT = `
const { execFileSync } = require('node:child_process');
const parent = Number(process.argv[1]);
const child = Number(process.argv[2]);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const kill = () => {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(child, 'SIGKILL');
  } catch (e) { /* already gone */ }
};
const timer = setInterval(() => {
  if (!alive(child)) process.exit(0);
  if (!alive(parent)) { kill(); process.exit(0); }
}, 500);
`;

export interface WatchdogGuardOptions {
  /** Node-compatible executable. Defaults to this process, run as node. */
  readonly nodeExe?: string;
  readonly parentPid?: number;
}

/** Fallback guard for builds without the native addon: a detached helper that watches the parent. */
export class WatchdogProcessGuard implements ProcessGuard {
  constructor(private readonly options: WatchdogGuardOptions = {}) {}

  protect(pid: number): ProtectedProcess {
    const helper: ChildProcess = spawn(
      this.options.nodeExe ?? process.execPath,
      ['-e', WATCHDOG_SCRIPT, String(this.options.parentPid ?? process.pid), String(pid)],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      },
    );
    helper.on('error', () => undefined);
    helper.unref();
    return {
      mechanism: 'watchdog',
      release: () => {
        try {
          helper.kill();
        } catch {
          // already gone
        }
      },
    };
  }
}

/** Guard backed by a kill-on-close Job Object. */
export class JobProcessGuard implements ProcessGuard {
  constructor(private readonly job: ProcessJobPort) {}

  protect(pid: number): ProtectedProcess {
    this.job.assign(pid);
    return { mechanism: 'job', release: () => undefined };
  }
}

/**
 * Job Object first; when it is missing or refuses (for example the child already sits in a
 * job that forbids nesting), the watchdog takes over so the child is never unguarded.
 */
export class FallbackProcessGuard implements ProcessGuard {
  constructor(
    private readonly primary: ProcessGuard | undefined,
    private readonly fallback: ProcessGuard,
  ) {}

  protect(pid: number): ProtectedProcess {
    if (this.primary) {
      try {
        return this.primary.protect(pid);
      } catch {
        // fall through to the watchdog
      }
    }
    return this.fallback.protect(pid);
  }
}

export function createProcessGuard(job?: ProcessJobPort, watchdog?: ProcessGuard): ProcessGuard {
  return new FallbackProcessGuard(
    job ? new JobProcessGuard(job) : undefined,
    watchdog ?? new WatchdogProcessGuard(),
  );
}
