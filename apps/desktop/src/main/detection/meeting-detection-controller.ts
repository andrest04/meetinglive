import {
  CallWatcher,
  POPUP_AUTO_HIDE_MS,
  POPUP_EXIT_MS,
  type Logger,
  type Scheduler,
  type WindowScanPort,
  type Workspace,
} from '@vozella/core';
import { activateMainWindow, type ActivatableWindow } from '../windows/activate-main-window';

/** The slice of the popup window the controller drives. Main wires it to Electron. */
export interface PopupHandle {
  /** Creates the window on first use and shows it without taking focus. */
  show(): void;
  /** Hides the window at once. */
  hide(): void;
  /** Tells the popup page to appear (meetingPrompt.show). */
  notifyShow(): void;
  /** Tells the popup page to leave (meetingPrompt.hide). */
  notifyHide(animated: boolean): void;
  dispose(): void;
}

export type MainWindowLike = ActivatableWindow;

/** The slice of the settings store the controller reads and writes. */
export interface PopupSettings {
  load(): Promise<{ readonly meetingPopupEnabled: boolean }>;
  update(patch: { meetingPopupEnabled: boolean }): Promise<unknown>;
}

export interface MeetingDetectionDeps {
  readonly scanner: WindowScanPort;
  readonly workspace: Workspace;
  readonly settings: PopupSettings;
  readonly popup: PopupHandle;
  readonly getMainWindow: () => MainWindowLike | null | undefined;
  /** The 5 s poll timer. */
  readonly scheduler: Scheduler;
  /** One shot timer; returns its cancel function. */
  readonly setTimeout: (callback: () => void, ms: number) => () => void;
  /** Tells every window the popup setting changed (so an open Settings page refreshes, S9). */
  readonly broadcastPopupSetting: (enabled: boolean) => void;
  readonly logger: Logger;
}

/**
 * Main side of meeting call detection: runs the call watcher, shows and hides the floating
 * popup, and answers its three buttons (items 121 to 124).
 */
export class MeetingDetectionController {
  readonly watcher: CallWatcher;
  private shown = false;
  private cancelAutoHide: (() => void) | null = null;
  private cancelExit: (() => void) | null = null;
  private offs: (() => void)[] = [];
  private wasCapturing: boolean;

  constructor(private readonly deps: MeetingDetectionDeps) {
    this.wasCapturing = deps.workspace.state.isCaptureActive;
    this.watcher = new CallWatcher({
      scanner: deps.scanner,
      workspace: {
        get state() {
          return deps.workspace.state;
        },
        offerCallPrompt: () => {
          deps.workspace.offerCallPrompt();
        },
      },
      settings: {
        readMeetingPopupEnabled: async () => (await deps.settings.load()).meetingPopupEnabled,
      },
      scheduler: deps.scheduler,
      logger: deps.logger,
    });
  }

  /** Starts polling and listening. Call once the main window exists. */
  start(): void {
    if (this.offs.length > 0) return;
    this.offs = [
      this.watcher.on('meetingDetected', () => {
        this.show();
      }),
      this.watcher.on('meetingEnded', () => {
        this.hideAnimated();
      }),
      // W14: a recording that starts from any path dismisses the popup.
      this.deps.workspace.on('scopeChanged', () => {
        const capturing = this.deps.workspace.state.isCaptureActive;
        const started = capturing && !this.wasCapturing;
        this.wasCapturing = capturing;
        if (started) this.hideAnimated();
      }),
    ];
    this.watcher.start();
  }

  /** W11: Start. The popup goes away without animation and a blank take is requested. */
  startTakingNotes(): void {
    this.hideNow();
    activateMainWindow(this.deps.getMainWindow());
    this.deps.workspace.requestTakeNotes();
  }

  /** W12: Dismiss. */
  dismiss(): void {
    this.hideAnimated();
  }

  /** True from a show until the hide starts. */
  get isShown(): boolean {
    return this.shown;
  }

  /** W8: the pointer over the card pauses the auto-hide, leaving it restarts the 30 s. */
  hover(inside: boolean): void {
    if (!this.shown) return;
    this.cancelAutoHide?.();
    this.cancelAutoHide = null;
    if (!inside) this.armAutoHide();
  }

  /** W13: Never again. Hides, then turns the setting off unless it already is. Never throws. */
  async neverAgain(): Promise<void> {
    this.hideAnimated();
    try {
      const current = await this.deps.settings.load();
      if (!current.meetingPopupEnabled) return;
      await this.deps.settings.update({ meetingPopupEnabled: false });
      this.deps.broadcastPopupSetting(false);
    } catch (error) {
      this.deps.logger.warn('Could not turn the call popup off', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  dispose(): void {
    this.watcher.stop();
    for (const off of this.offs) off();
    this.offs = [];
    this.clearTimers();
    this.shown = false;
    this.deps.popup.dispose();
  }

  private show(): void {
    this.clearTimers();
    this.shown = true;
    this.deps.popup.show();
    this.deps.popup.notifyShow();
    this.armAutoHide();
  }

  private armAutoHide(): void {
    this.cancelAutoHide = this.deps.setTimeout(() => {
      this.cancelAutoHide = null;
      this.hideAnimated();
    }, POPUP_AUTO_HIDE_MS);
  }

  private hideAnimated(): void {
    if (!this.shown) return;
    this.clearTimers();
    this.shown = false;
    this.deps.popup.notifyHide(true);
    this.cancelExit = this.deps.setTimeout(() => {
      this.cancelExit = null;
      this.deps.popup.hide();
    }, POPUP_EXIT_MS);
  }

  private hideNow(): void {
    if (!this.shown) return;
    this.clearTimers();
    this.shown = false;
    this.deps.popup.notifyHide(false);
    this.deps.popup.hide();
  }

  private clearTimers(): void {
    this.cancelAutoHide?.();
    this.cancelExit?.();
    this.cancelAutoHide = null;
    this.cancelExit = null;
  }
}
