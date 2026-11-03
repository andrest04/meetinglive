import type { Logger } from '@vozella/core';

export interface ErrorSource {
  on(event: 'uncaughtException', listener: (error: Error, origin: string) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

export interface GlobalErrorDeps {
  readonly logger: Logger;
  /** Show a last message to the user. Skipped in automated runs. */
  readonly showFatal: (title: string, detail: string) => void;
  readonly exit: (code: number) => void;
}

/**
 * Last line of defence in the main process. An uncaught exception leaves Node in an unknown
 * state, so it is logged, shown once, and the app exits. A rejected promise nobody handled
 * is logged and the app keeps running.
 */
export function installGlobalErrorHandling(source: ErrorSource, deps: GlobalErrorDeps): void {
  let fatalSeen = false;
  source.on('uncaughtException', (error, origin) => {
    deps.logger.error('uncaught exception', { error, origin });
    if (fatalSeen) return;
    fatalSeen = true;
    deps.showFatal('Vozella stopped unexpectedly', error.message);
    deps.exit(1);
  });
  source.on('unhandledRejection', (reason) => {
    deps.logger.error('unhandled promise rejection', { reason });
  });
}
