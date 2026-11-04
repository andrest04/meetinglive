import type { Logger } from '@vozella/core';

/**
 * The startup order of the shell (spec 2.1). The global error hooks come before everything. The
 * library migrations run before the window is created here, because the IPC handlers read the
 * library; their error is only shown after the window is visible, as in the WinUI app.
 */
export const STARTUP_ORDER = [
  'error-hooks',
  'language',
  'migrations',
  'window',
  'events',
  'watchers',
  'startup-notice',
] as const;

export type StartupStep = (typeof STARTUP_ORDER)[number];

export interface StartupMessage {
  readonly title: string;
  readonly content: string;
}

export interface StartupSequenceDeps {
  readonly logger: Logger;
  /** Shows one native message. Never called in automated runs. */
  readonly showError: (message: StartupMessage) => void;
  /** Builds the text for a failed step, in the language that is known at that point. */
  readonly describeFailure: (step: StartupStep, detail: string) => StartupMessage;
  /** Automated runs (mode test) log and show nothing. */
  readonly automated: boolean;
  /** Ends the app when a step the app cannot live without failed. */
  readonly exit: (code: number) => void;
}

export interface StepOptions {
  /** A failure is logged and never shown (a convenience such as call detection). */
  readonly silent?: boolean;
  /** A failure ends the app after the message. */
  readonly fatal?: boolean;
}

export type StepResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/**
 * Runs the named startup steps. A failing step is logged with its name and shown once with a clear
 * message, instead of ending startup silently (bug 21). Later failures are logged only.
 */
export class StartupSequence {
  private readonly done: StartupStep[] = [];
  private readonly failed: StartupStep[] = [];
  private shown = false;
  private pendingNotice: StartupMessage | null = null;

  constructor(private readonly deps: StartupSequenceDeps) {}

  /** Names of the steps that started, in order. */
  get ran(): readonly StartupStep[] {
    return this.done;
  }

  get failures(): readonly StartupStep[] {
    return this.failed;
  }

  async run<T>(
    step: StartupStep,
    work: () => T | Promise<T>,
    options: StepOptions = {},
  ): Promise<StepResult<T>> {
    this.done.push(step);
    try {
      return { ok: true, value: await work() };
    } catch (error) {
      this.failed.push(step);
      this.deps.logger.error('startup step failed', { step, error: detailOf(error) });
      if (!options.silent) this.show(this.deps.describeFailure(step, detailOf(error)));
      if (options.fatal) this.deps.exit(1);
      return { ok: false, error };
    }
  }

  /** A message that waits until the window is visible (the migration error). */
  queueNotice(message: StartupMessage): void {
    this.pendingNotice ??= message;
  }

  /** Shows the queued message, if any, once. Call when the window is visible. */
  flushNotice(): void {
    const message = this.pendingNotice;
    if (message === null) return;
    this.pendingNotice = null;
    this.show(message);
  }

  private show(message: StartupMessage): void {
    if (this.shown) {
      this.deps.logger.warn('startup message not shown, one is already', { title: message.title });
      return;
    }
    this.shown = true;
    if (this.deps.automated) return;
    try {
      this.deps.showError(message);
    } catch (error) {
      this.deps.logger.error('could not show the startup message', { error: detailOf(error) });
    }
  }
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
