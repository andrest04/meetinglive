/** One Library folder: metadata only. The directory on disk mirrors it. */
export interface FolderRecord {
  /** Lowercase hyphenated GUID. */
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly note: string | null;
  readonly colorKey: string | null;
  readonly iconKey: string | null;
  /** ISO 8601 with offset, as `folders.json` stores it. */
  readonly createdAt: string;
}
