import { CancelSource, type CancelSignal } from '../cancel';
import type { LiveQuestionsMode } from '../library/settings';
import {
  extractCommittedBody,
  isTranscriptHeader,
  parseCommittedLineEnd,
  splitCommittedLines,
} from '../transcription/committed-line';
import { detectNewQuestion, type DetectedQuestion } from './question-detector';

/** The optional engine check gives up after this long; the rules result then stands. */
export const LIVE_QUESTION_CHECK_TIMEOUT_MS = 8000;
/** The check sees this much of the transcript before the question. */
export const LIVE_QUESTION_CHECK_WINDOW_MS = 90_000;
const CHECK_WINDOW_MAX_CHARS = 6000;

/** One card: `confirmed` is false only while the engine check runs. */
export interface LiveQuestionEvent {
  readonly id: string;
  readonly body: string;
  readonly atMs: number;
  readonly confirmed: boolean;
}

export type QuestionCheckVerdict = 'yes' | 'no' | 'failed';

export interface LiveQuestionTrackerDeps {
  /** Read on every detection, so a change in Settings applies to the next question. */
  mode(): Promise<LiveQuestionsMode>;
  /** The engine's raw reply to the check prompt. Rejects when the engine fails. */
  confirm(prompt: string, cancel: CancelSignal): Promise<string>;
  detected(event: LiveQuestionEvent): void;
  withdrawn(id: string): void;
  /** Runs the detection later, off the caller's stack (the live transcript update). */
  schedule(run: () => void): void;
  /** Returns the function that clears the timer. */
  setTimer(run: () => void, ms: number): () => void;
}

// WinUI LiveQuestionJevJudge criteria, used as a yes or no prompt.
const DIRECT_QUESTION_INSTRUCTIONS =
  'Is this line a direct question that expects a factual or explanatory answer from someone in the room right now?';
const TRUE_CRITERIA =
  'Asks for a fact, definition, rule, procedure, or explanation, even if the transcript dropped the question mark. Includes a question asked to the room, not only to one person.';
const FALSE_CRITERIA =
  'A statement, acknowledgment, greeting, or a rhetorical check that people are following, such as "does that make sense", "¿se entiende?", "right?", or "ok?". It does not expect a factual answer.';

/** The committed lines whose end is within 90 s of the last line, headers left out. */
function recentWindow(committed: string): string {
  const lines = splitCommittedLines(committed).filter(
    (line) => line.trim() !== '' && !isTranscriptHeader(line),
  );
  const ends = lines.map(parseCommittedLineEnd);
  const lastEnd = ends.reduce<number | null>(
    (max, end) => (end === null ? max : Math.max(max ?? end, end)),
    null,
  );
  const kept =
    lastEnd === null
      ? lines
      : lines.filter((_, i) => {
          const end = ends[i];
          return (
            end !== null && end !== undefined && end >= lastEnd - LIVE_QUESTION_CHECK_WINDOW_MS
          );
        });
  const text = kept.map(extractCommittedBody).join('\n');
  return text.length > CHECK_WINDOW_MAX_CHARS ? text.slice(-CHECK_WINDOW_MAX_CHARS) : text;
}

export function buildQuestionCheckPrompt(question: string, committed: string): string {
  return [
    'You check lines of a live meeting transcript.',
    DIRECT_QUESTION_INSTRUCTIONS,
    `Answer yes when: ${TRUE_CRITERIA}`,
    `Answer no when: ${FALSE_CRITERIA}`,
    '',
    'Recent transcript:',
    recentWindow(committed),
    '',
    `Line: "${question}"`,
    '',
    'Reply with one word: yes or no.',
  ].join('\n');
}

export function parseQuestionCheckReply(reply: string): QuestionCheckVerdict {
  const first = reply
    .trim()
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .find((word) => word !== '');
  if (first === 'yes' || first === 'sí' || first === 'si') return 'yes';
  if (first === 'no') return 'no';
  return 'failed';
}

interface Card extends LiveQuestionEvent {
  readonly key: string;
}

/**
 * The live questions of one take (WinUI RecordingPageViewModel 380-606). Rules find a question in
 * newly committed lines; the card shows at once. With `rules+ai` the engine then says yes or no:
 * no withdraws the card, yes or any failure leaves it. A newer question, a dismissal or a new take
 * cancels a running check. Every shown question goes into the seen set, so a dismissed one never
 * returns in the take.
 */
export class LiveQuestionTracker {
  private previous = '';
  private pending: string | null = null;
  private scheduled = false;
  private readonly seen = new Set<string>();
  private current: Card | null = null;
  private check: CancelSource | null = null;
  /** Bumped by every detection, dismissal and reset: older async work sees it and drops out. */
  private generation = 0;
  private counter = 0;

  constructor(private readonly deps: LiveQuestionTrackerDeps) {}

  committed(text: string): void {
    this.pending = text;
    if (this.scheduled) return;
    this.scheduled = true;
    this.deps.schedule(() => {
      this.scheduled = false;
      this.process();
    });
  }

  /** True when the id was the card on screen. */
  dismiss(id: string): boolean {
    if (this.current?.id !== id) return false;
    this.generation += 1;
    this.cancelCheck();
    this.current = null;
    this.deps.withdrawn(id);
    return true;
  }

  /** A new take, Stop or Discard: the card goes and nothing of the take is kept. */
  reset(): void {
    this.generation += 1;
    this.cancelCheck();
    if (this.current !== null) this.deps.withdrawn(this.current.id);
    this.current = null;
    this.previous = '';
    this.pending = null;
    this.seen.clear();
  }

  private process(): void {
    const text = this.pending;
    this.pending = null;
    if (text === null) return;
    const found = detectNewQuestion(this.previous, text, this.seen);
    this.previous = text;
    if (found === null) return;
    this.seen.add(found.key);
    void this.surface(found, text);
  }

  private async surface(found: DetectedQuestion, committed: string): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.cancelCheck();
    this.counter += 1;
    const id = `q${String(this.counter)}`;
    let mode: LiveQuestionsMode;
    try {
      mode = await this.deps.mode();
    } catch {
      mode = 'rules';
    }
    if (generation !== this.generation || mode === 'off') return;
    const checking = mode === 'rules+ai';
    const card: Card = {
      id,
      body: found.body,
      atMs: found.lineStartMs ?? 0,
      confirmed: !checking,
      key: found.key,
    };
    this.current = card;
    this.emit(card);
    if (checking) await this.runCheck(card, committed, generation);
  }

  private async runCheck(card: Card, committed: string, generation: number): Promise<void> {
    const source = new CancelSource();
    this.check = source;
    let clearTimer: () => void = () => undefined;
    const timeout = new Promise<QuestionCheckVerdict>((resolve) => {
      clearTimer = this.deps.setTimer(() => {
        source.cancel();
        resolve('failed');
      }, LIVE_QUESTION_CHECK_TIMEOUT_MS);
    });
    const verdict = await Promise.race([
      this.deps
        .confirm(buildQuestionCheckPrompt(card.body, committed), source.signal)
        .then(parseQuestionCheckReply, () => 'failed' as const),
      timeout,
    ]);
    clearTimer();
    if (this.check === source) this.check = null;
    if (generation !== this.generation || this.current?.id !== card.id) return;
    if (verdict === 'no') {
      this.current = null;
      this.deps.withdrawn(card.id);
      return;
    }
    const confirmed: Card = { ...card, confirmed: true };
    this.current = confirmed;
    this.emit(confirmed);
  }

  private emit(card: Card): void {
    this.deps.detected({
      id: card.id,
      body: card.body,
      atMs: card.atMs,
      confirmed: card.confirmed,
    });
  }

  private cancelCheck(): void {
    this.check?.cancel();
    this.check = null;
  }
}
