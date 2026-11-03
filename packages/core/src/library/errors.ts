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
