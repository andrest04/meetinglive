import type { FolderRecord } from './folder';
import type { MeetingListItem, MeetingRecord } from './meeting';
import { meetingSnippet } from './snippet';
import { applySettingsPatch, readSettings, type AppSettings, type RawSettings } from './settings';
import type { FolderRepository, MeetingList, MeetingRepository, SettingsStore } from './ports';

/** Fake meeting store for tests and the fake-native build. Same contract as the file adapter. */
export class InMemoryMeetingRepository implements MeetingRepository {
  readonly records = new Map<string, MeetingRecord>();
  /** Ids whose delete throws, to exercise the locked-file path. */
  readonly lockedIds = new Set<string>();

  list(): Promise<MeetingList> {
    const items: MeetingListItem[] = [...this.records.values()].map((r) => ({
      id: r.id,
      title: r.title,
      recordedAt: r.recordedAt,
      folderId: r.folderId,
      snippet: meetingSnippet(r.summary, r.transcript),
    }));
    return Promise.resolve({ items, skipped: [] });
  }

  get(id: string): Promise<MeetingRecord | null> {
    return Promise.resolve(this.records.get(id) ?? null);
  }

  save(record: MeetingRecord): Promise<MeetingRecord> {
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  delete(id: string): Promise<void> {
    if (this.lockedIds.has(id)) {
      return Promise.reject(
        Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }),
      );
    }
    this.records.delete(id);
    return Promise.resolve();
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
