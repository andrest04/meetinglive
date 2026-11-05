import { MeetingTrashError } from './errors';
import type { FolderRecord } from './folder';
import type { MeetingListItem, MeetingRecord } from './meeting';
import { foldSearchText, meetingSearchText, type MeetingBody } from './meeting-search';
import { meetingListItem } from './snippet';
import { applySettingsPatch, readSettings, type AppSettings, type RawSettings } from './settings';
import type {
  FolderRepository,
  MeetingDeleteMode,
  MeetingList,
  MeetingRepository,
  SettingsStore,
} from './ports';

/** Fake meeting store for tests and the fake-native build. Same contract as the file adapter. */
export class InMemoryMeetingRepository implements MeetingRepository {
  readonly records = new Map<string, MeetingRecord>();
  /** Ids whose delete throws, to exercise the locked-file path. */
  readonly lockedIds = new Set<string>();
  /** Ids the Recycle Bin refuses. A permanent delete still works. */
  readonly trashRefusedIds = new Set<string>();

  list(): Promise<MeetingList> {
    const items = [...this.records.values()].map(meetingListItem);
    return Promise.resolve({ items, skipped: [] });
  }

  get(id: string): Promise<MeetingRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  async *bodies(filter: (item: MeetingListItem) => boolean): AsyncGenerator<MeetingBody> {
    for (const record of [...this.records.values()]) {
      const item = meetingListItem(record);
      if (!filter(item)) continue;
      const text = meetingSearchText(record);
      yield { item, folded: foldSearchText(text), original: () => Promise.resolve(text) };
      await Promise.resolve();
    }
  }

  save(record: MeetingRecord): Promise<MeetingRecord> {
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  delete(id: string, mode: MeetingDeleteMode = 'trash'): Promise<void> {
    if (mode === 'trash' && this.trashRefusedIds.has(id)) {
      return Promise.reject(new MeetingTrashError('The Recycle Bin refused the file.'));
    }
    if (this.lockedIds.has(id)) {
      return Promise.reject(
        Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }),
      );
    }
    this.records.delete(id);
    return Promise.resolve();
  }

  batch<T>(run: () => Promise<T>): Promise<T> {
    return run();
  }
}

export class InMemoryFolderRepository implements FolderRepository {
  folders: FolderRecord[] = [];

  getAll(): Promise<FolderRecord[]> {
    return Promise.resolve([...this.folders]);
  }

  save(folder: FolderRecord): Promise<void> {
    const index = this.folders.findIndex((f) => f.id === folder.id);
    if (index >= 0) this.folders[index] = folder;
    else this.folders.push(folder);
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.folders = this.folders.filter((f) => f.id !== id);
    return Promise.resolve();
  }
}

export class InMemorySettingsStore implements SettingsStore {
  private raw: RawSettings = {};

  load(): Promise<AppSettings> {
    return Promise.resolve(readSettings(this.raw));
  }

  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    this.raw = applySettingsPatch(this.raw, patch);
    return Promise.resolve(readSettings(this.raw));
  }
}
