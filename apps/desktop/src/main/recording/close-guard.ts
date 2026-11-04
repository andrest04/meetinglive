import type { Logger } from '@vozella/core';

/** The one dialog the shell shows at a time while the app closes (165). */
export type CloseDialog = 'confirm-stop' | 'saving' | 'save-failed' | 'done';

/** The recording state the guard reads (spec 2.16). */
export interface CloseGuardService {
  readonly requiresCloseConfirmation: boolean;
  readonly hasPendingSaves: boolean;
  /** Stops any capture, waits for every take to save, 30 s grace. True when all saved. */
  shutdown(): Promise<boolean>;
}

export interface CloseDialogs {
  /** "Stop recording before closing?" True: Stop and save. */
  confirmStop(): Promise<boolean>;
  /** The non-dismissable "Saving your recording" progress, until `hideSaving`. */
  showSaving(): void;
  hideSaving(): void;
  /** "The recording could not be saved". True: Close anyway. */
  saveFailed(): Promise<boolean>;
}

export interface CloseGuardDeps {
  readonly service: CloseGuardService;
  readonly dialogs: CloseDialogs;
  /** Un-minimizes the main window before the dialogs. */
  readonly restoreWindow: () => void;
  readonly logger: Logger;
}

/**
 * The exit gate of the recording module. `mayClose` is true when the app can go away now. A second
 * request while one is deciding is refused, and any exception means stay open.
 */
export class CloseGuard {
  private deciding = false;

  constructor(private readonly deps: CloseGuardDeps) {}

  async mayClose(): Promise<boolean> {
    const { service, dialogs } = this.deps;
    if (this.deciding) return false;
    this.deciding = true;
    try {
      if (!service.requiresCloseConfirmation && !service.hasPendingSaves) return true;
      this.deps.restoreWindow();
      if (service.requiresCloseConfirmation && !(await dialogs.confirmStop())) return false;
      dialogs.showSaving();
      let saved: boolean;
      try {
        saved = await service.shutdown();
      } finally {
        dialogs.hideSaving();
      }
      return saved ? true : await dialogs.saveFailed();
    } catch (error) {
      this.deps.logger.error('close protection failed, the app stays open', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      this.deciding = false;
    }
  }
}

export interface RendererDialogDeps {
  readonly send: (request: { requestId: string; dialog: CloseDialog }) => void;
  /** False when no window can show a dialog: the close is then refused. */
  readonly windowAvailable: () => boolean;
  readonly newId: () => string;
}

/**
 * Shows the close dialogs in the shell: main sends `recording.closeRequest` and waits for
 * `recording.closeAnswer`. The dialog UI is the shell's (R12).
 */
export class RendererCloseDialogs implements CloseDialogs {
  private readonly pending = new Map<string, (accepted: boolean) => void>();
  private savingId: string | null = null;

  constructor(private readonly deps: RendererDialogDeps) {}

  confirmStop(): Promise<boolean> {
    return this.ask('confirm-stop');
  }

  saveFailed(): Promise<boolean> {
    return this.ask('save-failed');
  }

  showSaving(): void {
    this.savingId = this.deps.newId();
    this.deps.send({ requestId: this.savingId, dialog: 'saving' });
  }

  hideSaving(): void {
    if (this.savingId === null) return;
    this.deps.send({ requestId: this.savingId, dialog: 'done' });
    this.savingId = null;
  }

  /** The shell's answer. False when the id is unknown or already answered. */
  answer(requestId: string, accepted: boolean): boolean {
    const resolve = this.pending.get(requestId);
    if (resolve === undefined) return false;
    this.pending.delete(requestId);
    resolve(accepted);
    return true;
  }

  private ask(dialog: 'confirm-stop' | 'save-failed'): Promise<boolean> {
    if (!this.deps.windowAvailable()) return Promise.reject(new Error('no window for the dialog'));
    const requestId = this.deps.newId();
    return new Promise<boolean>((resolve) => {
      this.pending.set(requestId, resolve);
      this.deps.send({ requestId, dialog });
    });
  }
}
