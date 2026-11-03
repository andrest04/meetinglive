import { isMeeting, type WindowScanPort } from '@vozella/core';

export interface TopLevelWindowInfo {
  /** Process image name without ".exe". */
  readonly processName: string;
  readonly title: string;
}

/** Where the open windows come from: the native addon, or a fake in tests. */
export interface WindowLister {
  listWindows(): Promise<readonly TopLevelWindowInfo[]>;
}

/**
 * Port: is any open top-level window a meeting call? Stops at the first match. A listing
 * that fails counts as "no call window", so a scan error never reaches the watcher.
 */
export class WindowScanner implements WindowScanPort {
  constructor(
    private readonly lister: WindowLister,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}

  async anyMeetingWindow(): Promise<boolean> {
    try {
      const windows = await this.lister.listWindows();
      for (const w of windows) {
        if (w.processName === '' || w.title === '') continue;
        if (isMeeting(w.processName, w.title)) return true;
      }
      return false;
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }
}
