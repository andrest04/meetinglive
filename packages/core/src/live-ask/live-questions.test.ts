import { describe, expect, it } from 'vitest';
import type { CancelSignal } from '../cancel';
import { formatLine } from '../transcription/stamp-format';
import {
  LIVE_QUESTION_CHECK_TIMEOUT_MS,
  LiveQuestionTracker,
  buildQuestionCheckPrompt,
  parseQuestionCheckReply,
  type LiveQuestionEvent,
} from './live-questions';
import type { LiveQuestionsMode } from '../library/settings';

const Q1 = '¿Cuál es el tercer principio del manifiesto ágil?';
const Q2 = 'what is the first principle of the agile manifesto?';

interface Pending {
  readonly prompt: string;
  readonly cancel: CancelSignal;
  resolve(reply: string): void;
  reject(error: unknown): void;
}

function setup(mode: LiveQuestionsMode = 'rules') {
  const detected: LiveQuestionEvent[] = [];
  const withdrawn: string[] = [];
  const checks: Pending[] = [];
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  let currentMode = mode;
  const tracker = new LiveQuestionTracker({
    mode: () => Promise.resolve(currentMode),
    confirm: (prompt, cancel) =>
      new Promise<string>((resolve, reject) => {
        checks.push({ prompt, cancel, resolve, reject });
      }),
    detected: (event) => detected.push(event),
    withdrawn: (id) => withdrawn.push(id),
    schedule: (run) => {
      run();
    },
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return () => {
        timer.cleared = true;
      };
    },
  });
  return {
    tracker,
    detected,
    withdrawn,
    checks,
    timers,
    setMode: (next: LiveQuestionsMode) => {
      currentMode = next;
    },
  };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};
const lines = (...items: string[]): string => items.join('\n');

describe('LiveQuestionTracker (rules)', () => {
  it('emits a new question once, confirmed, with its line start', async () => {
    const t = setup();
    const text = formatLine(4000, 9000, Q1);
    t.tracker.committed(text);
    await settle();
    t.tracker.committed(text);
    t.tracker.committed(lines(text, formatLine(9000, 12_000, 'vale, sigamos')));
    await settle();
    expect(t.detected).toEqual([
      { id: expect.any(String) as string, body: Q1, atMs: 4000, confirmed: true },
    ]);
  });

  it('never re-emits a dismissed question in the same take, even when it is said again', async () => {
    const t = setup();
    t.tracker.committed(formatLine(0, 4000, Q1));
    await settle();
    const id = t.detected[0]?.id ?? '';
    expect(t.tracker.dismiss(id)).toBe(true);
    expect(t.withdrawn).toEqual([id]);
    t.tracker.committed(lines(formatLine(0, 4000, Q1), formatLine(5000, 9000, `${Q1} `)));
    await settle();
    expect(t.detected).toHaveLength(1);
    expect(t.tracker.dismiss('unknown')).toBe(false);
  });

  it('a new take withdraws the card and forgets the seen questions', async () => {
    const t = setup();
    t.tracker.committed(formatLine(0, 4000, Q1));
    await settle();
    const first = t.detected[0]?.id;
    t.tracker.reset();
    expect(t.withdrawn).toEqual([first]);
    t.tracker.committed(formatLine(0, 4000, Q1));
    await settle();
    expect(t.detected).toHaveLength(2);
    expect(t.detected[1]?.id).not.toBe(first);
  });

  it('emits nothing when the mode is off', async () => {
    const t = setup('off');
    t.tracker.committed(formatLine(0, 4000, Q1));
    await settle();
    expect(t.detected).toEqual([]);
  });

  it('only the newest of two quick detections is shown', async () => {
    const t = setup();
    t.tracker.committed(formatLine(0, 4000, Q1));
    t.tracker.committed(lines(formatLine(0, 4000, Q1), formatLine(5000, 9000, Q2)));
    await settle();
    expect(t.detected.map((e) => e.body)).toEqual([Q2]);
  });
});

describe('LiveQuestionTracker (rules+ai)', () => {
  async function detect(t: ReturnType<typeof setup>, text: string) {
    t.tracker.committed(text);
    await settle();
  }

  it('shows the card unconfirmed, then confirms it on "yes"', async () => {
    const t = setup('rules+ai');
    await detect(t, formatLine(0, 4000, Q1));
    expect(t.detected).toEqual([expect.objectContaining({ body: Q1, confirmed: false })]);
    expect(t.checks[0]?.prompt).toContain(Q1);
    t.checks[0]?.resolve('Yes.');
    await settle();
    expect(t.detected[1]).toMatchObject({ id: t.detected[0]?.id, confirmed: true });
    expect(t.timers[0]?.cleared).toBe(true);
    expect(t.withdrawn).toEqual([]);
  });

  it('withdraws the card on "no"', async () => {
    const t = setup('rules+ai');
    await detect(t, formatLine(0, 4000, Q1));
    t.checks[0]?.resolve('no');
    await settle();
    expect(t.withdrawn).toEqual([t.detected[0]?.id]);
    expect(t.detected).toHaveLength(1);
  });

  it('keeps the card when the check fails or answers something else', async () => {
    const failing = setup('rules+ai');
    await detect(failing, formatLine(0, 4000, Q1));
    failing.checks[0]?.reject(new Error('cli failed'));
    await settle();
    expect(failing.withdrawn).toEqual([]);
    expect(failing.detected[1]).toMatchObject({ confirmed: true });

    const odd = setup('rules+ai');
    await detect(odd, formatLine(0, 4000, Q1));
    odd.checks[0]?.resolve('maybe');
    await settle();
    expect(odd.withdrawn).toEqual([]);
    expect(odd.detected[1]).toMatchObject({ confirmed: true });
  });

  it('times out after 8 s: the check is cancelled and the rules result stands', async () => {
    const t = setup('rules+ai');
    await detect(t, formatLine(0, 4000, Q1));
    expect(t.timers[0]?.ms).toBe(LIVE_QUESTION_CHECK_TIMEOUT_MS);
    expect(LIVE_QUESTION_CHECK_TIMEOUT_MS).toBe(8000);
    t.timers[0]?.run();
    await settle();
    expect(t.checks[0]?.cancel.cancelled).toBe(true);
    expect(t.detected[1]).toMatchObject({ confirmed: true });
    // A late "no" after the timeout changes nothing.
    t.checks[0]?.resolve('no');
    await settle();
    expect(t.withdrawn).toEqual([]);
  });

  it('a newer detection cancels the running check of the older one', async () => {
    const t = setup('rules+ai');
    await detect(t, formatLine(0, 4000, Q1));
    await detect(t, lines(formatLine(0, 4000, Q1), formatLine(5000, 9000, Q2)));
    expect(t.checks[0]?.cancel.cancelled).toBe(true);
    t.checks[0]?.resolve('no');
    await settle();
    expect(t.withdrawn).toEqual([]);
    expect(t.detected.map((e) => e.body)).toEqual([Q1, Q2]);
  });

  it('dismissing the card cancels its check', async () => {
    const t = setup('rules+ai');
    await detect(t, formatLine(0, 4000, Q1));
    t.tracker.dismiss(t.detected[0]?.id ?? '');
    expect(t.checks[0]?.cancel.cancelled).toBe(true);
    t.checks[0]?.resolve('yes');
    await settle();
    expect(t.detected).toHaveLength(1);
  });
});

describe('question check prompt', () => {
  it('carries the WinUI criteria, the line and only the last 90 s of transcript', () => {
    const text = lines(
      formatLine(0, 5000, 'old talk about lunch'),
      formatLine(100_000, 110_000, 'we compared the agile principles'),
      formatLine(120_000, 125_000, Q1),
    );
    const prompt = buildQuestionCheckPrompt(Q1, text);
    expect(prompt).toContain('direct question that expects a factual or explanatory answer');
    expect(prompt).toContain('even if the transcript dropped the question mark');
    expect(prompt).toContain('rhetorical check');
    expect(prompt).toContain('we compared the agile principles');
    expect(prompt).not.toContain('old talk about lunch');
    expect(prompt).toContain(`"${Q1}"`);
    expect(prompt).toMatch(/yes or no/i);
  });

  it.each([
    ['yes', 'yes'],
    [' Yes.', 'yes'],
    ['Sí', 'yes'],
    ['NO', 'no'],
    ['No, it is rhetorical', 'no'],
    ['', 'failed'],
    ['I think so', 'failed'],
  ] as const)('reads %j as %s', (reply, verdict) => {
    expect(parseQuestionCheckReply(reply)).toBe(verdict);
  });
});
