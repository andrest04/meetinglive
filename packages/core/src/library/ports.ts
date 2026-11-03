import type { FolderRecord } from './folder';
import type { MeetingListItem, MeetingRecord, SkippedMeetingFile } from './meeting';
import type { AppSettings } from './settings';

export interface MeetingList {
  readonly items: readonly MeetingListItem[];
  /** Files that could not be read as meetings. They are reported, never silently dropped. */
  readonly skipped: readonly SkippedMeetingFile[];
}

/** Port: where meetings live. Adapter: MarkdownMeetingRepository (platform). */
export interface MeetingRepository {
  /** Light list for the Library: no transcript or summary text. */
  list(): Promise<MeetingList>;
  get(id: string): Promise<MeetingRecord | null>;
  /** Writes the record, moving its files as needed. Returns the record as stored. */
  save(record: MeetingRecord): Promise<MeetingRecord>;
  /** No-op for an unknown id. A locked file throws and leaves the meeting listed. */
  delete(id: string): Promise<void>;
}

/** Port: the folder tree. Adapter: JsonFolderRepository (platform). */
export interface FolderRepository {
  getAll(): Promise<FolderRecord[]>;
  /** Upsert by id. Moves the folder's directory when its path changes. */
  save(folder: FolderRecord): Promise<void>;
  /** Removes the record and its directory if empty. The caller checks children and meetings. */
  delete(id: string): Promise<void>;
}

/** Port: settings.json. Updates are read-modify-write under one lock (B17). */
export interface SettingsStore {
  load(): Promise<AppSettings>;
  update(patch: Partial<AppSettings>): Promise<AppSettings>;
}

/** Port: other modules report meetings they are recording or processing. */
export interface MeetingBusyProbe {
  isBusy(meetingId: string): boolean;
}

/** Collects probes so the recording and re-transcription modules can each add theirs. */
export class MeetingBusyRegistry implements MeetingBusyProbe {
  private readonly probes = new Set<MeetingBusyProbe>();

  register(probe: MeetingBusyProbe): () => void {
    this.probes.add(probe);
    return () => {
      this.probes.delete(probe);
    };
  }

  isBusy(meetingId: string): boolean {
    for (const probe of this.probes) if (probe.isBusy(meetingId)) return true;
    return false;
  }
}
