/** A library file exists but cannot be read. Distinct from "missing", which reads as empty. */
export class LibraryFileCorruptError extends Error {
  constructor(
    readonly file: 'folders' | 'settings' | 'meetings',
    detail: string,
  ) {
    super(`The ${file} file is damaged: ${detail}`);
    this.name = 'LibraryFileCorruptError';
  }
}

/** The system refused to take a meeting's file into its Recycle Bin. The file is still there. */
export class MeetingTrashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeetingTrashError';
  }
}
