import type { MeetingRecord } from '../library/meeting';

/** Port: reveal a file in the system file manager. Adapter: Electron showItemInFolder (sv-2). */
export interface RevealPort {
  reveal(path: string): void | Promise<void>;
}

/** Item 62: the markdown path to reveal, or null when the record, path or file is missing. */
export function resolveRevealTarget(
  record: Pick<MeetingRecord, 'sourcePath'> | null,
  fileExists: (path: string) => boolean,
): string | null {
  const path = record?.sourcePath;
  if (!path || path.trim() === '') return null;
  return fileExists(path) ? path : null;
}
