export const ACCENT_KEYS = ['blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple'] as const;
export type AccentKey = (typeof ACCENT_KEYS)[number];

export const ICON_KEYS = [
  'folder',
  'briefcase',
  'people',
  'home',
  'star',
  'heart',
  'flag',
  'globe',
  'lock',
  'calendar',
  'mail',
  'chat',
  'video',
  'book',
  'pin',
  'tag',
  'education',
  'toolbox',
] as const;
export type IconKey = (typeof ICON_KEYS)[number];
export const DEFAULT_ICON_KEY: IconKey = 'folder';

/** FNV-1a over the id text: fixed for a given id, unlike the per-process .NET hash (B1). */
function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function canonical<T extends string>(keys: readonly T[], stored: string | null | undefined) {
  if (!stored) return undefined;
  const lower = stored.toLowerCase();
  return keys.find((key) => key === lower);
}

/** The stored color key, or a color derived from the folder id when none is stored. */
export function resolveAccentKey(stored: string | null | undefined, folderId: string): AccentKey {
  const known = canonical(ACCENT_KEYS, stored);
  if (known) return known;
  return ACCENT_KEYS[hashId(folderId.toLowerCase()) % ACCENT_KEYS.length] ?? 'blue';
}

/** First color not used by any folder; when all are used, wraps by how many are used. */
export function nextAccentKey(existing: readonly (string | null | undefined)[]): AccentKey {
  const used = new Set(
    existing.filter((key): key is string => typeof key === 'string').map((k) => k.toLowerCase()),
  );
  const free = ACCENT_KEYS.find((key) => !used.has(key));
  return free ?? ACCENT_KEYS[used.size % ACCENT_KEYS.length] ?? 'blue';
}

export function resolveIconKey(stored: string | null | undefined): IconKey {
  return canonical(ICON_KEYS, stored) ?? DEFAULT_ICON_KEY;
}
