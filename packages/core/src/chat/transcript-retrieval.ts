/**
 * Picks the transcript parts a question is about when the whole transcript does not fit (T2).
 * Pure: the transcript is cut into ~90 s windows, the windows are ranked with BM25 against the
 * question, and the best ones are returned in time order, followed by the recent tail.
 */
import { foldText } from '../library/text-fold';
import { cutPrefix, cutTail } from './text-cut';

export const RETRIEVAL_WINDOW_MS = 90_000;
/** Window size for a transcript without timestamps. */
export const RETRIEVAL_FALLBACK_CHARS = 1500;
/** The end of the recording is always kept, ranked or not. */
export const RETRIEVAL_TAIL_CHARS = 1500;

export interface TranscriptWindow {
  /** Start of the first stamped line, or null for an unstamped window. */
  readonly startMs: number | null;
  /** End of the last stamped line, or null for an unstamped window. */
  readonly endMs: number | null;
  readonly text: string;
}

export interface WindowOptions {
  readonly windowMs?: number;
  readonly fallbackChars?: number;
}

const STAMP = /^\[(\d{2,}):(\d{2})\.(\d{2})-(\d{2,}):(\d{2})\.(\d{2})\]/;

const toMs = (min: string | undefined, sec: string | undefined, cs: string | undefined): number =>
  (Number(min) * 60 + Number(sec)) * 1000 + Number(cs) * 10;

/** `[mm:ss.ff-mm:ss.ff]` at the start of a line, as start and end in ms. */
function parseStamp(line: string): { start: number; end: number } | null {
  const m = STAMP.exec(line);
  if (m === null || Number(m[2]) > 59 || Number(m[5]) > 59) return null;
  return { start: toMs(m[1], m[2], m[3]), end: toMs(m[4], m[5], m[6]) };
}

/** Consecutive lines up to `max` chars each; a longer line is cut into pieces. */
function charWindows(lines: readonly string[], max: number): TranscriptWindow[] {
  const out: TranscriptWindow[] = [];
  let current = '';
  const push = (): void => {
    if (current !== '') out.push({ startMs: null, endMs: null, text: current });
    current = '';
  };
  for (const line of lines) {
    let rest = line;
    while (rest.length > max) {
      push();
      const piece = cutPrefix(rest, max);
      out.push({ startMs: null, endMs: null, text: piece });
      rest = rest.slice(piece.length);
    }
    if (current !== '' && current.length + 1 + rest.length > max) push();
    current = current === '' ? rest : `${current}\n${rest}`;
  }
  push();
  return out;
}

/**
 * Plain text in pieces of at most `maxChars`, cut at line boundaries where it can be: the windows
 * the BM25 ranking scores for attached files, which have no timestamps.
 */
export function splitTextChunks(text: string, maxChars: number): string[] {
  return charWindows(text.split(/\r\n|\n|\r/), Math.max(1, maxChars)).map((w) => w.text);
}

/**
 * Cuts the transcript into windows. Stamped lines open a new window once they start `windowMs`
 * after the current window began; unstamped lines stay in the window they follow. A transcript
 * with no stamp at all is cut into windows of at most `fallbackChars`.
 */
export function splitTranscriptWindows(
  transcript: string,
  options: WindowOptions = {},
): TranscriptWindow[] {
  const windowMs = options.windowMs ?? RETRIEVAL_WINDOW_MS;
  const lines = transcript.split(/\r\n|\n|\r/);
  if (!lines.some((l) => parseStamp(l) !== null)) {
    return charWindows(lines, options.fallbackChars ?? RETRIEVAL_FALLBACK_CHARS);
  }
  const out: TranscriptWindow[] = [];
  let text: string[] = [];
  let startMs: number | null = null;
  let endMs: number | null = null;
  const push = (): void => {
    if (text.length > 0) out.push({ startMs, endMs, text: text.join('\n') });
    text = [];
    startMs = null;
    endMs = null;
  };
  for (const line of lines) {
    const stamp = parseStamp(line);
    if (stamp !== null) {
      if (startMs !== null && stamp.start >= startMs + windowMs) push();
      startMs ??= stamp.start;
      endMs = Math.max(endMs ?? stamp.end, stamp.end);
    }
    text.push(line);
  }
  push();
  return out;
}

/** A small es + en list: enough to stop "de", "the" and friends from deciding the ranking. */
const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a al algo como con de del el en es esa ese eso esta este esto fue ha hay la las le lo los mas ' +
    'me mi muy no o para pero por que se si sin sobre su sus te tu un una uno y ya yo ' +
    'an and are as at be but by did do for from had has have he i if in is it its me my no not of ' +
    'on or so that the their there they this to was we were what when where which who why will ' +
    'with you your'
  ).split(' '),
);

const SPEAKER_OR_STAMP = /\[[^\]\n]*\]/g;

/** Folded words of a text, without stamps, speaker tags, stopwords or one-letter words. */
export function tokenize(text: string): string[] {
  return foldText(text.replace(SPEAKER_OR_STAMP, ' ').normalize('NFC'))
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

const K1 = 1.2;
const B = 0.75;

/** BM25 score of every window against the query, in window order. */
export function scoreWindows(windows: readonly TranscriptWindow[], query: string): number[] {
  const terms = [...new Set(tokenize(query))];
  const docs = windows.map((w) => tokenize(w.text));
  if (terms.length === 0 || docs.length === 0) return windows.map(() => 0);
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const doc of docs) {
    const seen = new Set(doc);
    for (const term of terms) if (seen.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const n = df.get(term) ?? 0;
      if (n === 0) continue;
      let tf = 0;
      for (const word of doc) if (word === term) tf += 1;
      if (tf === 0) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avg));
    }
    return score;
  });
}

const pad = (n: number): string => String(n).padStart(2, '0');
const clock = (ms: number): string => {
  const total = Math.floor(ms / 1000);
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
};

function header(w: TranscriptWindow, last: boolean): string {
  if (w.startMs !== null && w.endMs !== null) return `[${clock(w.startMs)}–${clock(w.endMs)}]`;
  return last ? '[end]' : '[excerpt]';
}

const block = (w: TranscriptWindow, last = false): string => `${header(w, last)}\n${w.text}`;

const SEPARATOR = '\n\n';

/** The last `max` chars, started at a line boundary when one is inside them. */
function tailText(transcript: string, max: number): string {
  if (transcript.length <= max) return transcript;
  const cut = cutTail(transcript, max);
  const nl = cut.indexOf('\n');
  return nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut;
}

/**
 * The transcript within `budgetChars`: itself when it fits; otherwise the best ranked windows for
 * `query` in time order, each under its `[mm:ss–mm:ss]` range, then the recent tail.
 */
export function selectExcerpts(
  transcript: string,
  query: string,
  budgetChars: number,
  tailChars: number = RETRIEVAL_TAIL_CHARS,
): string {
  if (transcript.length <= budgetChars) return transcript;

  const tailBody = tailText(transcript, Math.max(0, Math.min(tailChars, budgetChars - 20)));
  const head = transcript.slice(0, transcript.length - tailBody.length);
  const tailWindows = splitTranscriptWindows(tailBody);
  const tailWindow: TranscriptWindow = {
    startMs: tailWindows.find((w) => w.startMs !== null)?.startMs ?? null,
    endMs: tailWindows.findLast((w) => w.endMs !== null)?.endMs ?? null,
    text: tailBody,
  };
  const tailBlock = block(tailWindow, true);

  const windows = splitTranscriptWindows(head.replace(/\r?\n$/, ''));
  const scores = scoreWindows(windows, query);
  const ranked = windows
    .map((w, index) => ({ w, index, score: scores[index] ?? 0 }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  let room = budgetChars - tailBlock.length;
  const picked: { w: TranscriptWindow; index: number }[] = [];
  for (const r of ranked) {
    const cost = block(r.w).length + SEPARATOR.length;
    if (cost > room) continue;
    picked.push(r);
    room -= cost;
  }
  picked.sort((a, b) => a.index - b.index);
  return [...picked.map((p) => block(p.w)), tailBlock].join(SEPARATOR);
}
