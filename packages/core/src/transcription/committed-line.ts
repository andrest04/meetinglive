import { HIGHLIGHT_MARKER_PREFIX } from './highlights';

/** Reads committed transcript lines in the stamp format (spec 3.13). */

/** Splits on CRLF, LF and lone CR, keeping empty entries. */
export function splitCommittedLines(transcript: string | null): string[] {
  if (transcript === null || transcript === '') return [];
  return transcript.split(/\r\n|\n|\r/);
}

export function isTranscriptHeader(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith('Recorded ') || trimmed.startsWith('Ended ');
}

/** `mm:ss.ff` where minutes have at least two digits, seconds are two digits and at most 59. */
function parseElapsed(text: string): number | null {
  const match = /^(\d{2,}):(\d{2})\.(\d{2})$/.exec(text);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (seconds > 59 || !Number.isSafeInteger(minutes)) return null;
  return minutes * 60_000 + seconds * 1000 + Number(match[3]) * 10;
}

interface Stamp {
  readonly startMs: number;
  readonly endMs: number;
  /** Index of the closing bracket in the unstarred line. */
  readonly close: number;
}

/** A starred line (`* [..]`) is read like the line under the star (B14). */
const unstar = (line: string): string =>
  line.startsWith(HIGHLIGHT_MARKER_PREFIX) ? line.slice(HIGHLIGHT_MARKER_PREFIX.length) : line;

function readStamp(line: string): Stamp | null {
  if (line === '' || !line.startsWith('[')) return null;
  const close = line.indexOf(']');
  if (close <= 1) return null;
  const stamp = line.slice(1, close);
  const dash = stamp.indexOf('-');
  if (dash <= 0 || dash >= stamp.length - 1) return null;
  const startMs = parseElapsed(stamp.slice(0, dash));
  const endMs = parseElapsed(stamp.slice(dash + 1));
  return startMs === null || endMs === null ? null : { startMs, endMs, close };
}

/** The end of the line's range, or null when the stamp is missing or malformed. */
export function parseCommittedLineEnd(line: string): number | null {
  return readStamp(unstar(line))?.endMs ?? null;
}

export function parseCommittedLineStart(line: string): number | null {
  return readStamp(unstar(line))?.startMs ?? null;
}

function stripSpeakerTag(afterStamp: string): string {
  const match = /^ \[ Speaker-(\d+) \]/.exec(afterStamp);
  return match ? afterStamp.slice(match[0].length) : afterStamp;
}

/** The spoken text without the star, the stamp and the speaker label. */
export function extractCommittedBody(line: string): string {
  if (line === '') return '';
  const plain = unstar(line);
  const stamp = readStamp(plain);
  if (stamp === null) return plain.trim();
  return stripSpeakerTag(plain.slice(stamp.close + 1)).trim();
}
