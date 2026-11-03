import type { Logger } from '@vozella/core';

/** What ManagedWorker needs from a child process. utilityProcess adapts to it. */
export interface WorkerProcess {
  postMessage(message: unknown): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
  kill(): void;
}

export type WorkerState = 'idle' | 'running' | 'restarting' | 'stopping' | 'stopped' | 'failed';

export interface ManagedWorkerOptions {
  readonly name: string;
  readonly spawn: () => WorkerProcess;
  readonly logger: Logger;
  readonly onMessage: (message: unknown) => void;
  /** Called after a crash restart, once the new process exists. Re-issue state here. */
  readonly onRestarted?: () => void;
  readonly onStateChange?: (state: WorkerState) => void;
  /** Crashes allowed inside `restartWindowMs` before giving up. Default 3. */
  readonly maxRestarts?: number;
  readonly restartWindowMs?: number;
  readonly backoffMs?: (attempt: number) => number;
  /** How long stop() waits for a clean exit before killing. Default 2000. */
  readonly stopTimeoutMs?: number;
  readonly now?: () => number;
}

/**
 * Lifecycle of one worker process: start, restart after a crash with backoff, stop.
 * A crash loop ends in 'failed' instead of spinning.
 */
export class ManagedWorker {
  private proc: WorkerProcess | undefined;
  private current: WorkerState = 'idle';
  private crashTimes: number[] = [];
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private stopWaiters: (() => void)[] = [];

  constructor(private readonly options: ManagedWorkerOptions) {}

  get state(): WorkerState {
    return this.current;
  }

  start(): void {
    if (this.current === 'running' || this.current === 'restarting') return;
    this.spawnProcess();
  }

  send(message: unknown): void {
    if (this.current !== 'running' || !this.proc) {
      throw new Error(`worker ${this.options.name} is not running (${this.current})`);
    }
    this.proc.postMessage(message);
  }

  /** Asks the worker to stop, kills it after the timeout, and resolves once it is gone. */
  stop(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    const proc = this.proc;
    if (
      !proc ||
      this.current === 'stopped' ||
      this.current === 'idle' ||
      this.current === 'failed'
    ) {
      this.setState('stopped');
      return Promise.resolve();
    }
    this.setState('stopping');
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        this.options.logger.warn(`worker ${this.options.name} did not stop in time, killing`);
        proc.kill();
        finish();
      }, this.options.stopTimeoutMs ?? 2000);
      this.stopWaiters.push(finish);
      try {
        proc.postMessage({ type: 'shutdown' });
      } catch {
        proc.kill();
      }
    });
  }

  private spawnProcess(): void {
    const proc = this.options.spawn();
    this.proc = proc;
    this.setState('running');
    proc.onMessage((message) => {
      if (this.proc === proc) this.options.onMessage(message);
    });
    proc.onExit((code) => {
      this.handleExit(proc, code);
    });
  }

  private handleExit(proc: WorkerProcess, code: number): void {
    if (this.proc !== proc) return;
    this.proc = undefined;
    const waiters = this.stopWaiters;
    this.stopWaiters = [];
    if (this.current === 'stopping') {
      this.setState('stopped');
      waiters.forEach((w) => {
        w();
      });
      return;
    }

    const now = (this.options.now ?? Date.now)();
    const windowMs = this.options.restartWindowMs ?? 30_000;
    this.crashTimes = [...this.crashTimes.filter((t) => now - t < windowMs), now];
    const maxRestarts = this.options.maxRestarts ?? 3;
    this.options.logger.error(`worker ${this.options.name} exited unexpectedly`, {
      code,
      crashesInWindow: this.crashTimes.length,
    });
    if (this.crashTimes.length > maxRestarts) {
      this.setState('failed');
      return;
    }
    this.setState('restarting');
    const delay = (this.options.backoffMs ?? defaultBackoff)(this.crashTimes.length);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.current !== 'restarting') return;
      this.spawnProcess();
      this.options.onRestarted?.();
    }, delay);
  }

  private setState(state: WorkerState): void {
    if (this.current === state) return;
    this.current = state;
    this.options.onStateChange?.(state);
  }
}

function defaultBackoff(attempt: number): number {
  return Math.min(200 * 2 ** (attempt - 1), 5_000);
}
