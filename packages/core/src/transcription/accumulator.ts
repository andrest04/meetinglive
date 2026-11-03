import type { AsrResult, AsrWord } from './asr-types';
import { formatHeader, formatLine } from './stamp-format';

const WINDOW_MS = 30_000;
/** Silence between words that starts a new idea line for the same speaker. */
export const IDEA_PAUSE_MS = 500;

const splitWhitespace = (text: string): string[] => text.split(/\s+/).filter((t) => t.length > 0);

export interface AccumulatorOptions {
  /** Line separator of the produced text. Internally text uses `\n`; the platform one is a persistence concern. */
  readonly newline?: string;
}

interface Window {
  startMs: number;
  endMs: number;
  tokens: string[];
  speakerTag: number;
}

/**
 * Builds the transcript from a streaming recognizer: finals become committed stamped lines,
 * interims replace one rewritten suffix (spec 3.6). No `ClockSkew`: it never had an effect (B1).
 */
export class StreamingTranscriptAccumulator {
  private readonly committed: string[] = [];
  private interim = '';
  /** Audio position the bare (unstamped) interim reached, so it can be stamped if it is committed (B18). */
  private interimBareEndMs: number | null = null;
  private lastEndMs = 0;
  private wroteHeader = false;
  private readonly newline: string;

  /** `recordedAtMs` null means the recording time is unknown: no header. */
  constructor(
    private readonly recordedAtMs: number | null,
    options: AccumulatorOptions = {},
  ) {
    this.newline = options.newline ?? '\n';
  }

  apply(result: AsrResult): void {
    const text = result.transcript.trim();
    if (result.isFinal) {
      if (text.length > 0) {
        this.ensureHeader();
        this.committed.push(...this.formatWindows(result, text, true).lines);
      }
      this.interim = '';
      this.interimBareEndMs = null;
      return;
    }
    if (text.length === 0) {
      this.interim = '';
      this.interimBareEndMs = null;
      return;
    }
    const formatted = this.formatWindows(result, text, false);
    this.interim = formatted.lines.join(this.newline);
    this.interimBareEndMs = formatted.bare
      ? Math.max(this.lastEndMs, Math.round(result.audioProcessedSeconds * 1000))
      : null;
  }

  /** Committed stamped lines plus the current interim suffix. */
  get displayText(): string {
    if (this.committed.length === 0) {
      if (this.interim === '') return '';
      return this.recordedAtMs === null
        ? this.interim
        : formatHeader(this.recordedAtMs) + this.newline + this.interim;
    }
    const committed = this.committed.join(this.newline);
    return this.interim === '' ? committed : committed + this.newline + this.interim;
  }

  /** Finals only: the authoritative transcript once the stream is done. */
  get committedText(): string {
    return this.committed.join(this.newline);
  }

  /** Keeps the last partial as committed lines when the engine never promoted it to a final. */
  commitRemainingInterim(): void {
    if (this.interim.trim() === '') return;
    this.ensureHeader();
    const lines = this.interim.split(/\r\n|\n/).filter((line) => line !== '');
    if (this.interimBareEndMs !== null) {
      // A bare interim has no stamp; one is added so the saved transcript stays parseable (B18).
      const text = lines.join(' ');
      this.committed.push(formatLine(this.lastEndMs, this.interimBareEndMs, text));
      this.lastEndMs = this.interimBareEndMs;
    } else {
      this.committed.push(...lines);
    }
    this.interim = '';
    this.interimBareEndMs = null;
  }

  private ensureHeader(): void {
    if (this.wroteHeader || this.recordedAtMs === null) return;
    this.committed.push(formatHeader(this.recordedAtMs));
    this.wroteHeader = true;
  }

  private formatWindows(
    result: AsrResult,
    text: string,
    commitTiming: boolean,
  ): { lines: string[]; bare: boolean } {
    const words = result.words;
    const first = words[0];
    const last = words[words.length - 1];
    let startMs: number;
    let endMs: number;
    if (first !== undefined && last !== undefined) {
      startMs = first.startMs;
      endMs = last.endMs;
    } else {
      startMs = this.lastEndMs;
      endMs = Math.max(startMs, Math.round(result.audioProcessedSeconds * 1000));
      if (!commitTiming && endMs === startMs) return { lines: [text], bare: true };
    }
    if (commitTiming) this.lastEndMs = endMs;

    if (first === undefined) return { lines: untimedWindows(startMs, endMs, text), bare: false };

    const single = endMs - startMs <= WINDOW_MS && sameSpeaker(words) && !hasIdeaPause(words);
    if (single) return { lines: [formatLine(startMs, endMs, text, first.speakerTag)], bare: false };

    const resolved = resolveTokens(words, text);
    if (resolved.tokens.length === 0) {
      return { lines: [formatLine(startMs, endMs, text, first.speakerTag)], bare: false };
    }
    const windows = buildWindows(words, resolved.tokens, startMs, endMs);
    const lines: string[] = [];
    for (const window of windows) {
      const windowText = window.tokens.join(resolved.joiner);
      if (windowText.length === 0) continue;
      lines.push(formatLine(window.startMs, window.endMs, windowText, window.speakerTag));
    }
    return { lines, bare: false };
  }
}

function sameSpeaker(words: readonly AsrWord[]): boolean {
  const tag = words[0]?.speakerTag;
  return words.every((word) => word.speakerTag === tag);
}

function hasIdeaPause(words: readonly AsrWord[]): boolean {
  for (let i = 1; i < words.length; i += 1) {
    const current = words[i];
    const previous = words[i - 1];
    if (current && previous && current.startMs - previous.endMs >= IDEA_PAUSE_MS) return true;
  }
  return false;
}

/**
 * Engine word texts when they pair one to one with the split text. Text with no spaces at all
 * (Japanese, Chinese) splits into one token while the engine reports many words: then the word
 * texts are used and joined with nothing, so the 30 s, speaker and pause rules still apply (B10).
 */
function resolveTokens(
  words: readonly AsrWord[],
  text: string,
): { tokens: string[]; joiner: string } {
  const split = splitWhitespace(text);
  const allText = words.every((word) => word.text !== null);
  if (allText && words.length === split.length) {
    return { tokens: words.map((word) => word.text ?? ''), joiner: ' ' };
  }
  if (allText && split.length === 1 && words.length > 1 && !/\s/.test(text)) {
    const pieces = words.map((word) => word.text ?? '');
    if (pieces.join('') === text) return { tokens: pieces, joiner: '' };
  }
  return { tokens: split, joiner: ' ' };
}

function buildWindows(
  words: readonly AsrWord[],
  tokens: readonly string[],
  startMs: number,
  endMs: number,
): Window[] {
  const pairCount = Math.min(tokens.length, words.length);
  const windows: Window[] = [];
  const firstWord = words[0];
  if (firstWord === undefined) return windows;
  let windowStart = firstWord.startMs;
  let windowSpeaker = firstWord.speakerTag;
  let current: string[] = [];
  let previousWordEnd = firstWord.endMs;

  for (let i = 0; i < pairCount; i += 1) {
    const word = words[i];
    if (word === undefined) break;
    const speakerChanged = current.length > 0 && word.speakerTag !== windowSpeaker;
    const windowElapsed = current.length > 0 && word.endMs - windowStart >= WINDOW_MS;
    const ideaPaused = current.length > 0 && word.startMs - previousWordEnd >= IDEA_PAUSE_MS;
    if (speakerChanged || windowElapsed || ideaPaused) {
      windows.push({
        startMs: windowStart,
        endMs: previousWordEnd,
        tokens: current,
        speakerTag: windowSpeaker,
      });
      current = [];
      windowStart = word.startMs;
      windowSpeaker = word.speakerTag;
    }
    current.push(tokens[i] ?? '');
    previousWordEnd = word.endMs;
  }
  if (current.length > 0) {
    windows.push({
      startMs: windowStart,
      endMs: previousWordEnd,
      tokens: current,
      speakerTag: windowSpeaker,
    });
  }
  if (tokens.length > pairCount) {
    const extra = tokens.slice(pairCount);
    const lastWindow = windows[windows.length - 1];
    if (lastWindow === undefined)
      windows.push({ startMs, endMs, tokens: [...extra], speakerTag: 0 });
    else lastWindow.tokens.push(...extra);
  }
  return windows;
}

/** Results with no word timings: the tokens are spread evenly over 30 s windows (spec 3.6). */
function untimedWindows(startMs: number, endMs: number, text: string): string[] {
  const duration = endMs - startMs;
  if (duration <= WINDOW_MS) return [formatLine(startMs, endMs, text)];
  const tokens = splitWhitespace(text);
  const count = Math.min(Math.ceil(duration / WINDOW_MS), tokens.length);
  if (count <= 1) return [formatLine(startMs, endMs, text)];
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const from = Math.floor((i * tokens.length) / count);
    const to = Math.floor(((i + 1) * tokens.length) / count);
    const windowStart = startMs + Math.floor((duration * i) / count);
    const windowEnd = i === count - 1 ? endMs : startMs + Math.floor((duration * (i + 1)) / count);
    lines.push(formatLine(windowStart, windowEnd, tokens.slice(from, to).join(' ')));
  }
  return lines;
}
