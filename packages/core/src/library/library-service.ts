import type { Clock } from '../clock';
import { LibraryFileCorruptError, MeetingTrashError } from './errors';
import type { FolderRecord } from './folder';
import { nextAccentKey, resolveAccentKey, resolveIconKey } from './folder-personality';
import { folderDirectoryName } from './names';
import { canDeleteFolder, isInLibraryView, type LibraryView } from './library-view';
import type { MeetingListItem, SkippedMeetingFile } from './meeting';
import { searchMeetings, type SearchHit } from './meeting-search';
import { formatOffsetDate, offsetDateFromInstant } from './offset-date';
import type {
  FolderRepository,
  MeetingBusyProbe,
  MeetingDeleteMode,
  MeetingRepository,
} from './ports';

export type FailureReason =
  | 'empty-name'
  | 'name-taken'
  | 'not-found'
  | 'not-empty'
  | 'busy'
  | 'corrupt'
  | 'io-failed'
  | 'trash-failed';

export interface Failure {
  readonly ok: false;
  readonly reason: FailureReason;
  /** The error text for `io-failed` and `trash-failed`, shown next to a localized lead-in. */
  readonly message?: string;
}

export type FolderResult = { readonly ok: true; readonly folder: FolderRecord } | Failure;
export type DoneResult = { readonly ok: true } | Failure;
/** One meeting's result in a bulk action. */
export type MeetingOutcome = { readonly meetingId: string } & DoneResult;
export type LoadResult =
  | {
      readonly ok: true;
      readonly folders: readonly FolderRecord[];
      readonly meetings: readonly MeetingListItem[];
      readonly skipped: readonly SkippedMeetingFile[];
    }
  | Failure;

export interface SearchResult {
  readonly requestId: number;
  /** A newer search replaced this one, so its hits are empty and mean nothing. */
  readonly stale: boolean;
  readonly hits: readonly SearchHit[];
}

export interface LibraryDeps {
  readonly meetings: MeetingRepository;
  readonly folders: FolderRepository;
  readonly busy: MeetingBusyProbe;
  readonly clock: Clock;
  readonly newId: () => string;
}

function failure(error: unknown): Failure {
  if (error instanceof LibraryFileCorruptError) {
    return { ok: false, reason: 'corrupt', message: error.message };
  }
  if (error instanceof MeetingTrashError) {
    return { ok: false, reason: 'trash-failed', message: error.message };
  }
  return {
    ok: false,
    reason: 'io-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

const sameDirectory = (a: string, b: string): boolean =>
  folderDirectoryName(a).toLowerCase() === folderDirectoryName(b).toLowerCase();

/**
 * The Library page's use cases (spec 3.13), without any view state. Every call reads fresh data,
 * and no call mutates records it was given, so a failed save leaves nothing half done (B13, B26).
 */
export class LibraryService {
  private latestSearch = 0;

  constructor(private readonly deps: LibraryDeps) {}

  async load(): Promise<LoadResult> {
    try {
      const [folders, list] = await Promise.all([
        this.deps.folders.getAll(),
        this.deps.meetings.list(),
      ]);
      const meetings = list.items.map((item) =>
        this.deps.busy.isBusy(item.id) ? { ...item, busy: true } : item,
      );
      return { ok: true, folders, meetings, skipped: list.skipped };
    } catch (error) {
      return failure(error);
    }
  }

  /** Full text across a view. Only the newest request runs to the end. */
  async search(input: {
    query: string;
    scope: LibraryView;
    requestId: number;
  }): Promise<SearchResult> {
    this.latestSearch += 1;
    const own = this.latestSearch;
    const isStale = (): boolean => own !== this.latestSearch;
    const known = await this.knownFolderIds();
    const hits = await searchMeetings({
      bodies: this.deps.meetings.bodies((item) => isInLibraryView(input.scope, known, item)),
      query: input.query,
      isStale,
    });
    return hits === null
      ? { requestId: input.requestId, stale: true, hits: [] }
      : { requestId: input.requestId, stale: false, hits };
  }

  /** A damaged folders file leaves meetings findable: as everywhere else, they read as Inbox. */
  private async knownFolderIds(): Promise<ReadonlySet<string>> {
    try {
      return new Set((await this.deps.folders.getAll()).map((folder) => folder.id));
    } catch (error) {
      if (error instanceof LibraryFileCorruptError) return new Set();
      throw error;
    }
  }

  isMeetingBusy(meetingId: string): boolean {
    return this.deps.busy.isBusy(meetingId);
  }

  async createFolder(input: { name: string; parentId: string | null }): Promise<FolderResult> {
    const name = input.name.trim();
    if (name === '') return { ok: false, reason: 'empty-name' };
    try {
      const folders = await this.deps.folders.getAll();
      if (input.parentId !== null && !folders.some((f) => f.id === input.parentId)) {
        return { ok: false, reason: 'not-found' };
      }
      if (this.nameTaken(folders, input.parentId, name, null)) {
        return { ok: false, reason: 'name-taken' };
      }
      const created = offsetDateFromInstant(this.deps.clock.now());
      const folder: FolderRecord = {
        id: this.deps.newId(),
        name,
        parentId: input.parentId,
        note: null,
        colorKey: nextAccentKey(folders.map((f) => f.colorKey)),
        iconKey: null,
        createdAt: formatOffsetDate(created, 'json'),
      };
      await this.deps.folders.save(folder);
      return { ok: true, folder };
    } catch (error) {
      return failure(error);
    }
  }

  async renameFolder(input: { id: string; name: string }): Promise<FolderResult> {
    const name = input.name.trim();
    if (name === '') return { ok: false, reason: 'empty-name' };
    return this.change(input.id, (folder, all) =>
      this.nameTaken(all, folder.parentId, name, folder.id)
        ? ({ ok: false, reason: 'name-taken' } as const)
        : { ...folder, name },
    );
  }

  async updatePersonality(input: {
    id: string;
    colorKey: string | null;
    iconKey: string | null;
  }): Promise<FolderResult> {
    return this.change(input.id, (folder) => ({
      ...folder,
      colorKey: resolveAccentKey(input.colorKey, folder.id),
      iconKey: resolveIconKey(input.iconKey),
    }));
  }

  /** Blank text is stored as null; an unchanged note is not saved again. */
  async setFolderNote(input: { id: string; note: string | null }): Promise<FolderResult> {
    const trimmed = input.note?.trim() ?? '';
    const note = trimmed === '' ? null : trimmed;
    return this.change(input.id, (folder) => (folder.note === note ? folder : { ...folder, note }));
  }

  async deleteFolder(id: string): Promise<DoneResult> {
    try {
      // Fresh data, not the page's snapshot: meetings may have been filed since it loaded.
      const [folders, list] = await Promise.all([
        this.deps.folders.getAll(),
        this.deps.meetings.list(),
      ]);
      const check = canDeleteFolder({ folders, meetings: list.items }, id);
      if (!check.allowed) return { ok: false, reason: check.reason };
      await this.deps.folders.delete(id);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  async moveMeeting(input: { meetingId: string; folderId: string | null }): Promise<DoneResult> {
    if (this.deps.busy.isBusy(input.meetingId)) return { ok: false, reason: 'busy' };
    try {
      const record = await this.deps.meetings.get(input.meetingId);
      if (record === null) return { ok: false, reason: 'not-found' };
      if (input.folderId !== null) {
        const folders = await this.deps.folders.getAll();
        if (!folders.some((f) => f.id === input.folderId))
          return { ok: false, reason: 'not-found' };
      }
      await this.deps.meetings.save({ ...record, folderId: input.folderId });
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  async deleteMeeting(id: string, mode: MeetingDeleteMode = 'trash'): Promise<DoneResult> {
    if (this.deps.busy.isBusy(id)) return { ok: false, reason: 'busy' };
    try {
      await this.deps.meetings.delete(id, mode);
      return { ok: true };
    } catch (error) {
      return failure(error);
    }
  }

  /** Each meeting on its own: one that cannot move stays and the rest still go. */
  async moveMeetings(input: {
    meetingIds: readonly string[];
    folderId: string | null;
  }): Promise<readonly MeetingOutcome[]> {
    return this.eachMeeting(input.meetingIds, (meetingId) =>
      this.moveMeeting({ meetingId, folderId: input.folderId }),
    );
  }

  /** Each meeting on its own: one that cannot go stays listed and the rest still go. */
  async deleteMeetings(input: {
    meetingIds: readonly string[];
    mode: MeetingDeleteMode;
  }): Promise<readonly MeetingOutcome[]> {
    return this.eachMeeting(input.meetingIds, (id) => this.deleteMeeting(id, input.mode));
  }

  private async eachMeeting(
    meetingIds: readonly string[],
    run: (meetingId: string) => Promise<DoneResult>,
  ): Promise<readonly MeetingOutcome[]> {
    return this.deps.meetings.batch(async () => {
      const outcomes: MeetingOutcome[] = [];
      for (const meetingId of new Set(meetingIds)) {
        outcomes.push({ meetingId, ...(await run(meetingId)) });
      }
      return outcomes;
    });
  }

  private nameTaken(
    folders: readonly FolderRecord[],
    parentId: string | null,
    name: string,
    selfId: string | null,
  ): boolean {
    // A folder whose parent no longer exists sits at the top level (B26b), so it competes with roots.
    const known = new Set(folders.map((f) => f.id));
    const effective = (f: FolderRecord): string | null =>
      f.parentId !== null && known.has(f.parentId) ? f.parentId : null;
    const wanted = parentId !== null && known.has(parentId) ? parentId : null;
    return folders.some(
      (f) => f.id !== selfId && effective(f) === wanted && sameDirectory(f.name, name),
    );
  }

  private async change(
    id: string,
    edit: (folder: FolderRecord, all: readonly FolderRecord[]) => FolderRecord | Failure,
  ): Promise<FolderResult> {
    try {
      const folders = await this.deps.folders.getAll();
      const current = folders.find((f) => f.id === id);
      if (!current) return { ok: false, reason: 'not-found' };
      const next = edit(current, folders);
      if ('ok' in next) return next;
      if (next !== current) await this.deps.folders.save(next);
      return { ok: true, folder: next };
    } catch (error) {
      return failure(error);
    }
  }
}
