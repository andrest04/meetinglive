import { CancelSource, type CancelSignal } from '../cancel';
import { isTranscriptHeader, splitCommittedLines } from '../transcription/committed-line';
import { takeHead } from './utf16';

/** An update is considered at most this often while recording. */
export const DIGEST_INTERVAL_MS = 120_000;
/** ...and only when at least this much committed text arrived since the last digest. */
export const DIGEST_MIN_NEW_CHARS = 600;
/** The digest the chat packs stays under this. */
export const DIGEST_MAX_CHARS = 1200;
/** A slow engine gives up after this long; the update is skipped. */
export const DIGEST_TIMEOUT_MS = 60_000;
/** How much new text one update reads: CLI engines and the 4096-token local model. */
export const DIGEST_INPUT_CLI_CHARS = 12_000;
export const DIGEST_INPUT_LOCAL_CHARS = 3000;

/** The engine the digest may use right now: answer language and how much text one update reads. */
export interface DigestEngine {
  /** `English` or `Spanish`, as the live answer prompt names it. */
  readonly language: string;
  readonly maxInputChars: number;
}

export interface RollingDigestDeps {
  nowMs(): number;
  /** Null when no digest should run (no engine, or a local model that is not loaded). */
  engine(): Promise<DigestEngine | null>;
  /** The engine's raw reply. Rejects when the engine fails. */
  complete(prompt: string, cancel: CancelSignal): Promise<string>;
  /** Returns the function that clears the timer. */
  setTimer(run: () => void, ms: number): () => void;
}

/** The running summary prompt: previous digest plus the new committed lines. */
export function buildDigestPrompt(
  previous: string | null,
  newLines: string,
  language: string,
): string {
  return [
    'You keep a running summary of a live meeting or class that is still going on.',
    'Update the running summary with the new transcript lines: keep what still matters from the previous summary, add what is new, and drop what was replaced or settled.',
    `Write at most 10 short bullet points in ${language}. Each starts with "- " and ends with the time it refers to as (mm:ss), taken from the line stamps.`,
    `Keep the whole summary under ${String(DIGEST_MAX_CHARS)} characters. Note decisions, tasks with owners, and open questions. Use only what was said. No title and no preamble.`,
    '',
    'Previous summary:',
    previous === null || previous.trim() === '' ? '(none)' : previous,
    '',
    'New transcript lines:',
    newLines,
  ].join('\n');
}

const FENCE = /^```[\w-]*\s*$/;

/** Trims the reply, drops code fences and keeps whole lines under the cap. Empty means failed. */
export function cleanDigestReply(reply: string): string {
  const lines = reply
    .split(/\r\n|\n|\r/)
    .filter((l) => !FENCE.test(l.trim()))
    .map((l) => l.trimEnd());
  const text = lines.join('\n').trim();
  if (text.length <= DIGEST_MAX_CHARS) return text;
  const cut = takeHead(text, DIGEST_MAX_CHARS);
  const lastBreak = cut.lastIndexOf('\n');
  return (lastBreak > 0 ? cut.slice(0, lastBreak) : cut).trimEnd();
}

/** The new committed lines, headers left out, cut to the most recent whole lines that fit. */
function newLinesWithin(text: string, max: number): string {
  const lines = splitCommittedLines(text).filter((l) => l.trim() !== '' && !isTranscriptHeader(l));
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? '';
    const next = size + line.length + (kept.length > 0 ? 1 : 0);
    if (next > max) break;
    kept.unshift(line);
    size = next;
  }
  return kept.join('\n');
}

/**
 * A short running summary of the take, kept while recording so the live chat knows what happened
 * before the recent tail. An update is considered every `DIGEST_INTERVAL_MS` and runs only when at
 * least `DIGEST_MIN_NEW_CHARS` of committed text is new. One update at a time; a failure or a
 * timeout skips it (the lines are tried again next interval). A new take, Stop or Discard resets
 * it. It never touches audio: the caller only hands it the committed text.
 */
export class RollingDigest {
  private text = '';
  private covered = 0;
  private digest: string | null = null;
  private lastAttemptMs = 0;
  private running: CancelSource | null = null;
  private generation = 0;

  constructor(private readonly deps: RollingDigestDeps) {
    this.lastAttemptMs = deps.nowMs();
  }

  /** The digest for the chat, or null before the first update. */
  get current(): string | null {
    return this.digest;
  }

  get inFlight(): boolean {
    return this.running !== null;
  }

  /** The whole committed text so far; called on every live update. */
  committed(text: string): void {
    // A shorter text is another take's start: nothing of the old one is new here.
    if (text.length < this.covered) this.covered = 0;
    this.text = text;
    if (this.running !== null) return;
    if (this.deps.nowMs() - this.lastAttemptMs < DIGEST_INTERVAL_MS) return;
    if (text.length - this.covered < DIGEST_MIN_NEW_CHARS) return;
    void this.update();
  }

  /** A new take, Stop or Discard: the running update ends and the digest goes. */
  reset(): void {
    this.generation += 1;
    this.running?.cancel();
    this.running = null;
    this.text = '';
    this.covered = 0;
    this.digest = null;
    this.lastAttemptMs = this.deps.nowMs();
  }

  private async update(): Promise<void> {
    const generation = this.generation;
    const source = new CancelSource();
    this.running = source;
    this.lastAttemptMs = this.deps.nowMs();
    const target = this.text.length;
    const fresh = this.text.slice(this.covered);
    let clearTimer: () => void = () => undefined;
    try {
      const engine = await this.deps.engine();
      if (engine === null || generation !== this.generation) return;
      const prompt = buildDigestPrompt(
        this.digest,
        newLinesWithin(fresh, engine.maxInputChars),
        engine.language,
      );
      const timeout = new Promise<string>((resolve) => {
        clearTimer = this.deps.setTimer(() => {
          source.cancel();
          resolve('');
        }, DIGEST_TIMEOUT_MS);
      });
      const reply = await Promise.race([this.deps.complete(prompt, source.signal), timeout]);
      if (generation !== this.generation || source.cancelled) return;
      const cleaned = cleanDigestReply(reply);
      if (cleaned === '') return;
      this.digest = cleaned;
      this.covered = target;
    } catch {
      // Skipped: the digest stays as it was and the lines are read again next time.
    } finally {
      clearTimer();
      if (this.running === source) this.running = null;
    }
  }
}
