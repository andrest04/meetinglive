import type { Logger } from '../logging';
import { shouldShowPopup } from './popup-policy';

/** Poll period of the call watcher (item 98). */
export const CALL_POLL_INTERVAL_MS = 5000;

/** Port: repeating timer. Adapter lives in main; tests use a fake. */
export interface Scheduler {
  /** Runs `callback` every `intervalMs` until the returned function is called. */
  setInterval(callback: () => void, intervalMs: number): () => void;
}

/** Port: is any meeting call window open right now. */
export interface WindowScanPort {
  anyMeetingWindow(): Promise<boolean>;
}

/** The slice of Workspace the watcher needs. */
export interface CallWatcherWorkspace {
  readonly state: { readonly isCaptureActive: boolean };
  offerCallPrompt(): void;
}

export interface CallWatcherSettings {
  readMeetingPopupEnabled(): Promise<boolean>;
}

export interface CallWatcherPorts {
  scanner: WindowScanPort;
  workspace: CallWatcherWorkspace;
  settings: CallWatcherSettings;
  scheduler: Scheduler;
  logger: Logger;
}

export type CallWatcherEvent = 'meetingDetected' | 'meetingEnded';

/**
 * Detects a meeting call and emits at most one `meetingDetected` per call.
 * Re-armed only after no call window is seen, which emits `meetingEnded`.
 */
export class CallWatcher {
  private armed = true;
  private windowFound = false;
  private ticking = false;
  private stopTimer: (() => void) | null = null;
  private readonly handlers: Record<CallWatcherEvent, Set<() => void>> = {
    meetingDetected: new Set(),
    meetingEnded: new Set(),
  };

  constructor(private readonly ports: CallWatcherPorts) {}

  on(event: CallWatcherEvent, handler: () => void): () => void {
    this.handlers[event].add(handler);
    return () => this.handlers[event].delete(handler);
  }

  start(): void {
    if (this.stopTimer) return;
    this.stopTimer = this.ports.scheduler.setInterval(() => {
      void this.tick();
    }, CALL_POLL_INTERVAL_MS);
  }

  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
  }

  /** One poll. Never throws; an overlapping call is dropped. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    let disarmedThisTick = false;
    try {
      const inCall = await this.ports.scanner.anyMeetingWindow();
      if (inCall !== this.windowFound) {
        this.windowFound = inCall;
        this.ports.logger.info(inCall ? 'Call window found' : 'Call window gone');
      }
      if (!inCall) {
        if (!this.armed) {
          this.armed = true;
          this.emit('meetingEnded');
        }
        return;
      }
      if (!this.armed) return;
      if (this.ports.workspace.state.isCaptureActive) {
        this.armed = false;
        return;
      }
      this.armed = false;
      disarmedThisTick = true;
      this.ports.workspace.offerCallPrompt();
      const enabled = await this.readPopupEnabled();
      if (shouldShowPopup(enabled, this.ports.workspace.state.isCaptureActive, false)) {
        this.emit('meetingDetected');
      } else {
        this.ports.logger.info('Call detected, popup not shown', { enabled });
      }
      disarmedThisTick = false;
    } catch (error) {
      if (disarmedThisTick) this.armed = true;
      this.safeLog('Call watcher tick failed', error);
    } finally {
      this.ticking = false;
    }
  }

  private async readPopupEnabled(): Promise<boolean> {
    try {
      return await this.ports.settings.readMeetingPopupEnabled();
    } catch (error) {
      this.safeLog('Reading the popup setting failed, defaulting to on', error);
      return true;
    }
  }

  private emit(event: CallWatcherEvent): void {
    for (const handler of [...this.handlers[event]]) handler();
  }

  private safeLog(message: string, error: unknown): void {
    try {
      this.ports.logger.warn(message, {
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // logging must not break the watcher
    }
  }
}
