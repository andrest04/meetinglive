import fs from 'node:fs/promises';
import {
  applySettingsPatch,
  parseSettingsJson,
  readSettings,
  serializeSettings,
  LibraryFileCorruptError,
  type AppSettings,
  type Logger,
  type RawSettings,
  type SettingsStore,
} from '@vozella/core';
import { writeFileAtomic } from '../fs/atomic-write';
import { fileLocks, lockKeyFor, type KeyedMutex } from '../fs/keyed-mutex';
import { errorCode, exists } from './library-layout';

export interface JsonSettingsStoreOptions {
  readonly settingsFilePath: string;
  /** Called before every write (spec 3.17: Save runs EnsureDirectoriesExist first). */
  readonly ensureDirectories?: () => Promise<void>;
  readonly logger?: Logger;
  readonly locks?: KeyedMutex;
}

/**
 * `settings.json` in the app data root. Reads never throw on a damaged file: the app starts
 * with defaults, and the damaged file is moved aside (not overwritten) on the next write.
 * `update` is read-modify-write under one lock and changes only the fields in the patch, so two
 * callers cannot overwrite each other's fields (B17), and keys it does not know are kept.
 */
export class JsonSettingsStore implements SettingsStore {
  private readonly locks: KeyedMutex;

  constructor(private readonly options: JsonSettingsStoreOptions) {
    this.locks = options.locks ?? fileLocks;
  }

  async load(): Promise<AppSettings> {
    return readSettings(await this.locked(() => this.readRaw()));
  }

  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.locked(async () => {
      await this.options.ensureDirectories?.();
      const raw = await this.readRaw();
      const next = applySettingsPatch(raw, patch);
      await writeFileAtomic(this.options.settingsFilePath, serializeSettings(next));
      return readSettings(next);
    });
  }

  private locked<T>(work: () => Promise<T>): Promise<T> {
    return this.locks.run(lockKeyFor(this.options.settingsFilePath), work);
  }

  private async readRaw(): Promise<RawSettings> {
    let text: string;
    try {
      text = await fs.readFile(this.options.settingsFilePath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return {};
      throw error;
    }
    try {
      return parseSettingsJson(text).raw;
    } catch (error) {
      if (!(error instanceof LibraryFileCorruptError)) throw error;
      const aside = await this.moveAside();
      this.options.logger?.warn('settings.json is damaged; using defaults', {
        error: error.message,
        keptAs: aside,
      });
      return {};
    }
  }

  /** `settings.json.corrupt`, then `.corrupt.1`, ... Never overwrites an earlier copy. */
  private async moveAside(): Promise<string> {
    const base = `${this.options.settingsFilePath}.corrupt`;
    let target = base;
    for (let n = 1; await exists(target); n += 1) target = `${base}.${n}`;
    await fs.rename(this.options.settingsFilePath, target);
    return target;
  }
}
