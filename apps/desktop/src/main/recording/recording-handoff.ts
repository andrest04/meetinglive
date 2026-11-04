import {
  decideRecordingHandoff,
  shouldShowRecordingPill,
  type RecordingHandoffDecision,
} from '@vozella/core';

/** The slice of the main window the handoff drives. */
export interface HandoffWindow {
  isDestroyed(): boolean;
  minimize(): void;
}

/** A window that must close with the main window (the live copilot pill, the call popup). */
export interface SecondaryWindow {
  isDestroyed(): boolean;
  close(): void;
}

/**
 * What the live copilot pill needs to follow the handoff (the pill window is built by the live
 * copilot module; this is the seam it plugs into).
 */
export interface HandoffEvent {
  readonly isRecording: boolean;
  readonly mainWindowActive: boolean;
  /** True only on the recording start: the pill plays its "Recording started" hint. */
  readonly showStartedHint: boolean;
  /** `shouldShowRecordingPill(isRecording, mainWindowActive, handingOff)`. */
  readonly showPill: boolean;
}

export interface RecordingHandoffDeps {
  readonly getMainWindow: () => HandoffWindow | null | undefined;
  /** Hides the "Meeting detected" popup, whose offer is moot once recording starts (item 77). */
  readonly dismissPopup: () => void;
}

/** The seam: the live copilot module subscribes with `onHandoff` to show, hide and hint its pill. */
export type HandoffListener = (event: HandoffEvent) => void;

/**
 * The shell side of the recording start (spec 2.8, items 76 to 78, 89). It follows the main-side
 * recording state and acts on the false to true change only: dismiss the popup, minimize the main
 * window, treat it as inactive at once, and tell the pill. Pause, resume, import, discard and stop
 * never minimize.
 */
export class RecordingHandoff {
  private wasRecording = false;
  private recording = false;
  private active = true;
  private readonly secondary = new Set<SecondaryWindow>();
  private readonly listeners = new Set<HandoffListener>();

  constructor(private readonly deps: RecordingHandoffDeps) {}

  get mainWindowActive(): boolean {
    return this.active;
  }

  /** Feed every change of the recording state. Repeats are harmless. */
  update(isRecording: boolean): RecordingHandoffDecision {
    const decision = decideRecordingHandoff(this.wasRecording, isRecording);
    this.wasRecording = isRecording;
    this.recording = isRecording;
    if (isRecording) this.deps.dismissPopup();
    if (decision.minimizeMainWindow) {
      const main = this.deps.getMainWindow();
      if (main && !main.isDestroyed()) main.minimize();
      // After minimizing, so a focus event raised by the minimize cannot leave this true and hide
      // the pill (item 78).
      this.active = false;
    }
    this.emit(decision.showStartedHint);
    return decision;
  }

  /** The main window gained or lost focus (the Activated event of the WinUI window). */
  setMainWindowActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    this.emit(false);
  }

  /** Calls `listener` on every handoff and every focus change. Returns the unsubscribe. */
  onHandoff(listener: HandoffListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** A window that closes when the main window closes (item 89). Returns the unregister. */
  registerSecondary(window: SecondaryWindow): () => void {
    this.secondary.add(window);
    return () => {
      this.secondary.delete(window);
    };
  }

  /** Called when the main window is closing. Closes every registered window, which lets the app exit. */
  closeSecondary(): void {
    for (const window of [...this.secondary]) {
      this.secondary.delete(window);
      if (!window.isDestroyed()) window.close();
    }
  }

  private emit(showStartedHint: boolean): void {
    const event: HandoffEvent = {
      isRecording: this.recording,
      mainWindowActive: this.active,
      showStartedHint,
      showPill: shouldShowRecordingPill(this.recording, this.active, showStartedHint),
    };
    for (const listener of [...this.listeners]) listener(event);
  }
}
