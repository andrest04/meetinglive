export const MAX_TITLE_LENGTH = 80;

/** Auto-title formats known to core; callers add the localized catalog values as data. */
export const DEFAULT_PLACEHOLDER_FORMATS: readonly string[] = ['Meeting {0}'];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds placeholder patterns from MeetingTitleFormat catalog values such as
 * "Meeting {0}" and "Reunión {0}": the text before {0}, then whitespace and a digit.
 */
export function placeholderPatternsFromFormats(formats: readonly string[]): RegExp[] {
  const patterns: RegExp[] = [];
  for (const format of formats) {
    const prefix = (format.split('{0}')[0] ?? '').trim();
    if (prefix === '') continue;
    patterns.push(new RegExp(`^${escapeRegExp(prefix)}\\s+\\d`, 'i'));
  }
  return patterns;
}

const DEFAULT_PATTERNS = placeholderPatternsFromFormats(DEFAULT_PLACEHOLDER_FORMATS);

export function normalizeTitle(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const first = raw.split(/\r?\n/).find((l) => l.trim() !== '');
  if (first === undefined) return null;
  let value = first.trim().replace(/^#+/, '').trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith('“') && value.endsWith('”')))
  ) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/\.+$/, '').trim();
  if (value.length > MAX_TITLE_LENGTH) value = value.slice(0, MAX_TITLE_LENGTH).trim();
  return value === '' ? null : value;
}

/** Blank titles and auto titles ("Meeting 3", "Reunión 3 nov") are placeholders. */
export function looksLikePlaceholder(
  title: string | null | undefined,
  patterns: readonly RegExp[] = DEFAULT_PATTERNS,
): boolean {
  if (title === null || title === undefined || title.trim() === '') return true;
  const t = title.trim();
  return patterns.some((p) => p.test(t));
}

/** Replaces the current title only when it is a placeholder. */
export function resolveTitle(
  current: string,
  suggested: string | null | undefined,
  patterns: readonly RegExp[] = DEFAULT_PATTERNS,
): string {
  const normalized = normalizeTitle(suggested);
  if (normalized === null) return current;
  return looksLikePlaceholder(current, patterns) ? normalized : current;
}
