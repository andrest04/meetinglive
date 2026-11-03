/**
 * The library's JSON files are written by .NET's default encoder: non-ASCII characters and
 * `<`, `>`, `&`, `'`, `+`, and the backtick appear as `\uXXXX`. Readers accept both forms, but
 * writing the same shape keeps diffs against files the WinUI app wrote small.
 */
export function escapeLikeDotNet(json: string): string {
  return json.replace(
    /[^ -~\n]|[<>&'+`]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
  );
}

/** Compact JSON as `System.Text.Json` would write it. */
export function stringifyCompact(value: unknown): string {
  return escapeLikeDotNet(JSON.stringify(value));
}

/** Indented JSON (two spaces) with the platform newline, as `WriteIndented` writes it. */
export function stringifyIndented(value: unknown, newline: '\r\n' | '\n' = '\r\n'): string {
  const text = escapeLikeDotNet(JSON.stringify(value, null, 2));
  return newline === '\n' ? text : text.replace(/\n/g, newline);
}

/** Strips a leading byte order mark. Node's file reader does not. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const GUID =
  /^[{(]?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})[})]?$/i;

/** Lowercase hyphenated form of any standard GUID text, or null. */
export function parseGuid(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = GUID.exec(text.trim());
  return match ? match.slice(1, 6).join('-').toLowerCase() : null;
}
