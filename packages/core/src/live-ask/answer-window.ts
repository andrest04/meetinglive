/** The recent part of the committed transcript a live answer reads (recording spec 3.12). */

export const DEFAULT_ANSWER_WINDOW_MS = 90_000;
export const UNSTAMPED_FALLBACK_CHARS = 2500;

const TIME = /^(\d{2,}):(\d{2})\.(\d{2})$/;

function parseTime(text: string): number | null {
  const match = TIME.exec(text);
  if (match === null) return null;
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  return (Number(match[1]) * 60 + seconds) * 1000 + Number(match[3]) * 10;
}

/** The end time of a `[mm:ss.ff-mm:ss.ff]` stamp, or null when the line has none. */
export function parseStampEnd(line: string): number | null {
  if (!line.startsWith('[')) return null;
  const close = line.indexOf(']');
  if (close < 2) return null;
  const range = line.slice(1, close);
  const dash = range.indexOf('-');
  if (dash < 0) return null;
  const start = parseTime(range.slice(0, dash));
  const end = parseTime(range.slice(dash + 1));
  return start === null || end === null ? null : end;
}

function isHeader(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('Recorded ') || t.startsWith('Ended ');
}

export function takeRecentWindow(
  committedText: string | null | undefined,
  windowMs: number = DEFAULT_ANSWER_WINDOW_MS,
): string {
  if (committedText === null || committedText === undefined || committedText === '') return '';
  const lines = committedText.split(/\r\n|\n|\r/);
  const ends = lines.map(parseStampEnd);
  let latest: number | null = null;
  for (const end of ends) if (end !== null && (latest === null || end > latest)) latest = end;
  if (latest === null) {
    return committedText.length > UNSTAMPED_FALLBACK_CHARS
      ? committedText.slice(committedText.length - UNSTAMPED_FALLBACK_CHARS)
      : committedText;
  }
  const cutoff = latest - windowMs;
  const inSpan = (end: number | null): boolean => end !== null && end >= cutoff && end <= latest;
  let first = -1;
  let last = -1;
  ends.forEach((end, index) => {
    if (!inSpan(end)) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return '';
  const kept: string[] = [];
  lines.forEach((line, index) => {
    if (isHeader(line)) return;
    const end = ends[index] ?? null;
    if (end !== null ? inSpan(end) : index >= first && index <= last) kept.push(line);
  });
  return kept.join(committedText.includes('\r\n') ? '\r\n' : '\n');
}
