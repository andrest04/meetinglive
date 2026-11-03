// The control characters are exactly what Windows forbids in file names.
// eslint-disable-next-line no-control-regex
const INVALID_FILE_NAME_CHARS = /["<>|:*?\\/\u0000-\u001f]/g;
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_LENGTH = 80;
const RESERVED_FOLDER_NAMES = ['inbox', 'meetings', 'recordings'];

/** Strips trailing whitespace and dots together, so "abc ." cannot leave "abc ". */
function trimEdges(value: string): string {
  return value.trimStart().replace(/[\s.]+$/u, '');
}

function cut(value: string, max: number): string {
  if (value.length <= max) return value;
  const last = value.charCodeAt(max - 1);
  const keep = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return value.slice(0, keep);
}

/**
 * A file or directory name that is valid on Windows (spec 3.3). Always uses the Windows
 * rule set, so a library synced between systems stays consistent.
 */
export function sanitizeName(name: string | null | undefined): string {
  if (name == null || name.trim() === '') return 'Meeting';
  let value = name.trim().replace(INVALID_FILE_NAME_CHARS, ' ');
  value = value.replace(/ {2,}/g, ' ');
  value = trimEdges(value);
  value = trimEdges(cut(value, MAX_LENGTH));
  if (value.trim() === '') return 'Meeting';
  if (value.toLowerCase() === 'inbox') return 'Inbox folder';
  // Windows treats CON, NUL, COM1 and friends as devices, with or without an extension.
  return value.replace(/^[^.]*/u, (stem) => (DEVICE_NAME.test(stem) ? `${stem}_` : stem));
}

/**
 * Directory name for a Library folder. `Inbox` is the unfiled directory, and `Meetings` and
 * `Recordings` are the legacy flat dumps, so none of them may be a user folder's directory.
 */
export function folderDirectoryName(name: string): string {
  const safe = sanitizeName(name);
  return RESERVED_FOLDER_NAMES.includes(safe.toLowerCase()) ? `${safe} folder` : safe;
}

/**
 * `YYYY-MM-DD <title>`, with the date in the record's own stored offset.
 * `recordedAt` is the round-trip text, whose first ten characters are that date.
 */
export function fileStem(recordedAt: string, title: string): string {
  return `${recordedAt.slice(0, 10)} ${sanitizeName(title)}`;
}
