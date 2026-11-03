import { parseGuid, stringifyIndented, stripBom } from './dotnet-json';
import { LibraryFileCorruptError } from './errors';
import type { FolderRecord } from './folder';
import { formatOffsetDate, parseOffsetDate } from './offset-date';

function lowerKeys(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, v] of Object.entries(value)) out[key.toLowerCase()] = v;
  }
  return out;
}

const optionalString = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Reads `folders.json` (spec 4.2). Any damage raises LibraryFileCorruptError. */
export function parseFoldersJson(text: string): FolderRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (error) {
    throw new LibraryFileCorruptError(
      'folders',
      error instanceof Error ? error.message : 'invalid JSON',
    );
  }
  if (!Array.isArray(raw)) throw new LibraryFileCorruptError('folders', 'expected a JSON array');
  return (raw as unknown[]).map((entry, index) => {
    const o = lowerKeys(entry);
    const id = parseGuid(optionalString(o.id));
    const name = optionalString(o.name);
    const created = parseOffsetDate(optionalString(o.createdat) ?? '');
    if (id === null || name === null || created === null) {
      throw new LibraryFileCorruptError(
        'folders',
        `entry ${index} lacks a valid id, name or createdAt`,
      );
    }
    const parent = optionalString(o.parentid);
    return {
      id,
      name,
      parentId: parent === null ? null : parseGuid(parent),
      note: optionalString(o.note),
      colorKey: optionalString(o.colorkey),
      iconKey: optionalString(o.iconkey),
      createdAt: formatOffsetDate(created, 'json'),
    };
  });
}

/** Writes `folders.json` the way the WinUI app does: camelCase, nulls kept, CRLF, .NET escaping. */
export function serializeFolders(
  folders: readonly FolderRecord[],
  newline: '\r\n' | '\n' = '\r\n',
): string {
  return stringifyIndented(
    folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      note: f.note,
      colorKey: f.colorKey,
      iconKey: f.iconKey,
      createdAt: f.createdAt,
    })),
    newline,
  );
}
