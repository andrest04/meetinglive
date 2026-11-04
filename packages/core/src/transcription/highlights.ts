import { formatElapsed } from './stamp-format';

/** Stars the stamped lines at the moments the user marked while recording (spec 3.13). */
export const HIGHLIGHT_MARKER_PREFIX = '* ';

const MARK_LINE = /^\* (\d+):(\d{2}\.\d{2})\s*$/;
const LINE_RANGE = /^\[(\d+):(\d{2}\.\d{2})-(\d+):(\d{2}\.\d{2})\]/;

export const formatMarkLine = (elapsedMs: number): string =>
  HIGHLIGHT_MARKER_PREFIX + formatElapsed(elapsedMs);

/** Minutes may have more digits than an int holds (B19), so this uses a double. */
function parseElapsed(minutes: string, seconds: string): number {
  return Math.round(Number(minutes) * 60_000 + Number(seconds) * 1000);
}

const stripMarker = (line: string): string =>
  line.startsWith(HIGHLIGHT_MARKER_PREFIX) ? line.slice(HIGHLIGHT_MARKER_PREFIX.length) : line;

interface Indexed {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
}

function findLineIndex(indexed: readonly Indexed[], mark: number): number {
  // Lines abut (previous end == next start): a mark on the boundary belongs to the line that starts there.
  for (const candidate of indexed) {
    if (mark === candidate.startMs) return candidate.index;
  }
  for (const candidate of indexed) {
    if (mark >= candidate.startMs && mark <= candidate.endMs) return candidate.index;
  }
  let previous = indexed[0];
  for (const candidate of indexed) {
    if (candidate.startMs > mark) break;
    previous = candidate;
  }
  return previous?.index ?? 0;
}

function stampedLines(lines: readonly string[]): Indexed[] {
  const indexed: Indexed[] = [];
  lines.forEach((line, index) => {
    const match = LINE_RANGE.exec(stripMarker(line));
    if (match) {
      indexed.push({
        index,
        startMs: parseElapsed(match[1] ?? '0', match[2] ?? '0'),
        endMs: parseElapsed(match[3] ?? '0', match[4] ?? '0'),
      });
    }
  });
  return indexed;
}

/**
 * Prefixes the line each mark falls in with `* `. A mark between lines stars the previous line,
 * one before the first stamped line stars that first line. Idempotent; CRLF or LF is kept.
 */
export function applyHighlights(
  transcript: string | null,
  highlightsMs: readonly number[],
): string {
  const marks = [...new Set(highlightsMs.map((time) => Math.max(0, time)))].sort((a, b) => a - b);
  if (marks.length === 0) return transcript ?? '';
  if (transcript === null || transcript === '') return marks.map(formatMarkLine).join('\n');

  const newline = transcript.includes('\r\n') ? '\r\n' : '\n';
  const lines = transcript.split(/\r\n|\n/);
  const indexed = stampedLines(lines);
  if (indexed.length === 0) return [...lines, ...marks.map(formatMarkLine)].join(newline);

  for (const mark of marks) {
    const at = findLineIndex(indexed, mark);
    const line = lines[at] ?? '';
    if (!line.startsWith(HIGHLIGHT_MARKER_PREFIX)) lines[at] = HIGHLIGHT_MARKER_PREFIX + line;
  }
  return lines.join(newline);
}

/**
 * The starred lines of a transcript as elapsed start times, so they can be re-applied (B8).
 * Marks-only lines (`* mm:ss.ff`, written when nothing was stamped) are recovered too.
 */
export function starredLineStarts(transcript: string): number[] {
  const lines = transcript.split(/\r\n|\n/);
  const starts: number[] = [];
  const stamped = new Map(stampedLines(lines).map((entry) => [entry.index, entry.startMs]));
  lines.forEach((line, index) => {
    if (!line.startsWith(HIGHLIGHT_MARKER_PREFIX)) return;
    const start = stamped.get(index);
    if (start !== undefined) {
      starts.push(start);
      return;
    }
    const mark = MARK_LINE.exec(line);
    if (mark) starts.push(parseElapsed(mark[1] ?? '0', mark[2] ?? '0'));
  });
  return starts;
}
