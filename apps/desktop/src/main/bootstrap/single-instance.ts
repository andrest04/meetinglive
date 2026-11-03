export interface SingleInstanceDeps {
  readonly requestLock: () => boolean;
  /** True when this process was started by the app's own restart. */
  readonly relaunched: boolean;
  readonly sleep: (ms: number) => void;
  /** How long a relaunched process waits for the old one to let go. */
  readonly waitMs?: number;
  readonly stepMs?: number;
}

/** The argument the app adds when it restarts itself, so the new process waits for the old one. */
export const RELAUNCH_ARG = '--vozella-relaunched';

/**
 * Takes the single instance lock. After a restart the old process may still be shutting down, so
 * a relaunched process retries for a few seconds instead of quitting at once. Without that the
 * language restart could end with no app running.
 */
export function acquireSingleInstance(deps: SingleInstanceDeps): boolean {
  if (deps.requestLock()) return true;
  if (!deps.relaunched) return false;
  const step = deps.stepMs ?? 100;
  for (let waited = 0; waited < (deps.waitMs ?? 8000); waited += step) {
    deps.sleep(step);
    if (deps.requestLock()) return true;
  }
  return false;
}

/** Blocks the thread briefly. Only used at start up, before any window exists. */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface RelaunchDeps {
  readonly argv: readonly string[];
  readonly relaunch: (options: { args: string[] }) => void;
  readonly quit: () => void;
  /** Runs the quit after the current call stack, so the answer to the page goes out first. */
  readonly defer: (run: () => void) => void;
}

/**
 * Starts the new process, marked as a relaunch, then quits this one. The mark is never doubled,
 * so a chain of restarts keeps one flag.
 */
export function relaunchApp(deps: RelaunchDeps): void {
  const args = deps.argv.slice(1).filter((arg) => arg !== RELAUNCH_ARG);
  deps.relaunch({ args: [...args, RELAUNCH_ARG] });
  deps.defer(deps.quit);
}
