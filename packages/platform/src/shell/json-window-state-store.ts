import fs from 'node:fs/promises';
import { sanitizeWindowState, type SavedWindowState } from '@vozella/core';
import { writeFileAtomic, type AtomicWriteOptions } from '../fs/atomic-write';

export interface JsonWindowStateStoreOptions {
  /** Called when a save fails. The window must never fail because its geometry was not saved. */
  readonly onError?: (error: unknown) => void;
  readonly retryDelaysMs?: AtomicWriteOptions['retryDelaysMs'];
}

/**
 * Holds the main window geometry in `window-state.json` under the app data folder. It is its
 * own file, not `settings.json`, so a bad write here can never damage the user's settings.
 */
export class JsonWindowStateStore {
  constructor(
    private readonly file: string,
    private readonly options: JsonWindowStateStoreOptions = {},
  ) {}

  /** The saved state, or null when the file is missing, unreadable or not a window state. */
  async load(): Promise<SavedWindowState | null> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch {
      return null;
    }
    try {
      return sanitizeWindowState(JSON.parse(text));
    } catch {
      return null;
    }
  }

  /** Writes atomically. Never throws. */
  async save(state: SavedWindowState): Promise<void> {
    try {
      await writeFileAtomic(this.file, `${JSON.stringify(state, null, 2)}\n`, {
        retryDelaysMs: this.options.retryDelaysMs,
      });
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
