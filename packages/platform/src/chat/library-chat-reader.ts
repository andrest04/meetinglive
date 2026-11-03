import {
  MEETING_CAP,
  compactMeetingId,
  type ChatMeetingReader,
  type ContextFolder,
  type ContextMeeting,
  type FolderRepository,
  type MeetingListItem,
  type MeetingRepository,
} from '@vozella/core';

export interface LibraryChatReaderDeps {
  readonly meetings: MeetingRepository;
  readonly folders: Pick<FolderRepository, 'getAll'>;
}

const recordedMs = (item: MeetingListItem): number => {
  const ms = Date.parse(item.recordedAt);
  return Number.isNaN(ms) ? 0 : ms;
};

/** The same order the packer uses: newest first, ties by compact id descending. */
const newestFirst = (a: MeetingListItem, b: MeetingListItem): number => {
  const diff = recordedMs(b) - recordedMs(a);
  if (diff !== 0) return diff;
  const ia = compactMeetingId(a.id);
  const ib = compactMeetingId(b.id);
  return ia < ib ? 1 : ia > ib ? -1 : 0;
};

/** A meeting the packer counts but never prints: older than the newest `MEETING_CAP`. */
const stub = (item: MeetingListItem): ContextMeeting => ({
  id: item.id,
  title: item.title,
  recordedAt: item.recordedAt,
  folderId: item.folderId,
  summary: null,
  notes: null,
  transcript: null,
  actionItems: [],
});

/**
 * Reads meetings for chat over the Markdown repository (B17). The list is the repository's own
 * light index, so a send never parses every transcript: only the newest `MEETING_CAP` records are
 * read in full. Older ones come back as stubs so the packer's "Showing the 12 most recent of N"
 * note still counts them.
 */
export class LibraryChatReader implements ChatMeetingReader {
  constructor(private readonly deps: LibraryChatReaderDeps) {}

  meetingById(id: string): Promise<ContextMeeting | null> {
    return this.deps.meetings.get(id);
  }

  async meetingsInFolder(folderId: string): Promise<readonly ContextMeeting[]> {
    const key = compactMeetingId(folderId);
    const { items } = await this.deps.meetings.list();
    return this.load(
      items.filter((item) => item.folderId !== null && compactMeetingId(item.folderId) === key),
    );
  }

  async listRecent(): Promise<readonly ContextMeeting[]> {
    const { items } = await this.deps.meetings.list();
    return this.load(items);
  }

  listFolders(): Promise<readonly ContextFolder[]> {
    return this.deps.folders.getAll();
  }

  /**
   * Citation check (B21): the id may be hex without hyphens. Answers the stored id so the page
   * can select the meeting. Reads the light list only.
   */
  async findMeetingId(id: string): Promise<string | null> {
    const key = compactMeetingId(id);
    const { items } = await this.deps.meetings.list();
    return items.find((item) => compactMeetingId(item.id) === key)?.id ?? null;
  }

  private async load(items: readonly MeetingListItem[]): Promise<readonly ContextMeeting[]> {
    const sorted = [...items].sort(newestFirst);
    const records = await Promise.all(
      sorted
        .slice(0, MEETING_CAP)
        .map(async (item) => (await this.deps.meetings.get(item.id)) ?? stub(item)),
    );
    return [...records, ...sorted.slice(MEETING_CAP).map(stub)];
  }
}
