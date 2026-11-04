/** One displayed piece of a transcript line. The pieces joined give back the stored line. */
export interface LinePart {
  readonly kind: 'star' | 'stamp' | 'text';
  readonly text: string;
}

export interface TranscriptLine {
  readonly key: number;
  readonly text: string;
  readonly starred: boolean;
  readonly blank: boolean;
  /** Where the line starts in the audio, from its stamp; null for lines without one. */
  readonly startSeconds: number | null;
  readonly parts: readonly LinePart[];
}

const STAMP = /^\[\d+:\d{2}\.\d{2}-\d+:\d{2}\.\d{2}\]/;
const START = /^(?:\* )?\[(\d+):(\d{2})\.(\d{2})-/;

/** The start second of a stamped line, or null. Header lines and mid-line brackets give null. */
export function parseStartSeconds(line: string): number | null {
  const m = START.exec(line);
  if (!m || !STAMP.test(line.startsWith('* ') ? line.slice(2) : line)) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100;
}

/** Splits on \r\n, \n and \r. The stored text is shown line by line, never rewritten. */
export function splitTranscript(text: string): string[] {
  return text.split(/\r\n|\n|\r/);
}

/** Non-whitespace test of the empty state (parity 68, 69). */
export function hasTranscriptContent(text: string | null | undefined): text is string {
  return text !== null && text !== undefined && text.trim().length > 0;
}

/** Splits one line into star prefix, time stamp and the rest, keeping every character. */
export function parseLine(text: string): readonly LinePart[] {
  const parts: LinePart[] = [];
  let rest = text;
  if (rest.startsWith('* ')) {
    parts.push({ kind: 'star', text: '* ' });
    rest = rest.slice(2);
  }
  const stamp = STAMP.exec(rest);
  if (stamp) {
    parts.push({ kind: 'stamp', text: stamp[0] });
    rest = rest.slice(stamp[0].length);
  }
  if (rest.length > 0) parts.push({ kind: 'text', text: rest });
  return parts;
}

export function toLines(text: string): readonly TranscriptLine[] {
  return splitTranscript(text).map((line, key) => ({
    key,
    text: line,
    starred: line.startsWith('* '),
    blank: line.length === 0,
    startSeconds: parseStartSeconds(line),
    parts: parseLine(line),
  }));
}
