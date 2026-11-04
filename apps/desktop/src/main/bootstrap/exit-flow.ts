import type { Logger } from '@vozella/core';

export interface ExitFlowDeps {
  /** The exit gates: the recording close guard first. */
  readonly mayExit: () => Promise<boolean>;
  readonly quit: () => void;
  readonly closeWindow: () => void;
  readonly logger: Logger;
}

interface Preventable {
  preventDefault(): void;
}

/**
 * Window close, quit, tray quit and the language restart share one gate (item 99). Once the gate
 * approved, the quit or the close it triggers goes through without asking again (item 100). An
 * exception in the gate is logged as `close failed` and leaves the app open (item 97).
 */
export class ExitFlow {
  private isApproved = false;

  constructor(private readonly deps: ExitFlowDeps) {}

  get approved(): boolean {
    return this.isApproved;
  }

  /** The gate already said yes (the restart asks it before it relaunches). */
  approve(): void {
    this.isApproved = true;
  }

  /** The `before-quit` event. True when the quit may go on now. */
  beforeQuit(event: Preventable): boolean {
    if (this.isApproved) return true;
    event.preventDefault();
    void this.decide(() => {
      this.deps.quit();
    });
    return false;
  }

  /** The main window `close` event. */
  windowClose(event: Preventable): void {
    if (this.isApproved) return;
    event.preventDefault();
    void this.decide(() => {
      this.deps.closeWindow();
    });
  }

  private async decide(proceed: () => void): Promise<void> {
    let ok = false;
    try {
      ok = await this.deps.mayExit();
    } catch (error) {
      this.deps.logger.error('close failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!ok) return;
    this.isApproved = true;
    proceed();
  }
}
