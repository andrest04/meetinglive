import { describe, expect, it } from 'vitest';
import type { CancelSignal } from '../cancel';
import {
  DIGEST_INTERVAL_MS,
  DIGEST_MAX_CHARS,
  DIGEST_MIN_NEW_CHARS,
  RollingDigest,
  buildDigestPrompt,
  cleanDigestReply,
  type DigestEngine,
} from './rolling-digest';

interface Call {
  readonly prompt: string;
  readonly cancel: CancelSignal;
  resolve(reply: string): void;
  reject(error: Error): void;
}

const line = (sec: number, text: string): string => {
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  return `[${mm}:${ss}.00-${mm}:${ss}.50] ${text}`;
};

/** About `chars` of committed text, in stamped lines. */
const transcript = (chars: number, from = 0): string => {
  const lines: string[] = [];
  let total = 0;
  let sec = from;
  while (total < chars) {
    const l = line(sec, `We talked about the budget and the roadmap for the next quarter ${sec}.`);
    lines.push(l);
    total += l.length + 1;
    sec += 5;
  }
  return lines.join('\n');
};

function harness(engine: DigestEngine | null = { language: 'English', maxInputChars: 8000 }) {
  let now = 0;
  const calls: Call[] = [];
  let enabledReads = 0;
  const digest = new RollingDigest({
    nowMs: () => now,
    engine: () => {
      enabledReads += 1;
      return Promise.resolve(engine);
    },
    complete: (prompt, cancel) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ prompt, cancel, resolve, reject });
      }),
    setTimer: () => () => undefined,
  });
  digest.reset();
  return {
    digest,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
    enabledReads: () => enabledReads,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('RollingDigest scheduling', () => {
  it('waits for the interval and the new-text threshold before asking the engine', async () => {
    const h = harness();
    h.digest.committed(transcript(DIGEST_MIN_NEW_CHARS + 100));
    await flush();
    expect(h.calls).toHaveLength(0); // interval not reached

    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(DIGEST_MIN_NEW_CHARS - 200));
    await flush();
    expect(h.calls).toHaveLength(0); // too little new text

    h.digest.committed(transcript(DIGEST_MIN_NEW_CHARS + 100));
    await flush();
    expect(h.calls).toHaveLength(1);
  });

  it('keeps one update in flight and stores the cleaned reply', async () => {
    const h = harness();
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(1000));
    await flush();
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(3000));
    await flush();
    expect(h.calls).toHaveLength(1);
    h.calls[0]?.resolve('  - Budget agreed (00:05)\n- Roadmap next (00:40)  ');
    await flush();
    expect(h.digest.current).toBe('- Budget agreed (00:05)\n- Roadmap next (00:40)');
    expect(h.digest.inFlight).toBe(false);
  });

  it('feeds the previous digest and only the new lines into the next update', async () => {
    const h = harness();
    const first = transcript(1000);
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(first);
    await flush();
    h.calls[0]?.resolve('- First part (00:05)');
    await flush();

    const second = `${first}\n${transcript(1000, 500)}`;
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(second);
    await flush();
    expect(h.calls).toHaveLength(2);
    const prompt = h.calls[1]?.prompt ?? '';
    expect(prompt).toContain('- First part (00:05)');
    expect(prompt).toContain('[08:20.00-08:20.50]');
    expect(prompt).not.toContain('[00:00.00-00:00.50]');
  });

  it('skips a failed update: the digest stays and the lines are tried again next interval', async () => {
    const h = harness();
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(1000));
    await flush();
    h.calls[0]?.reject(new Error('engine down'));
    await flush();
    expect(h.digest.current).toBeNull();
    expect(h.digest.inFlight).toBe(false);

    h.digest.committed(transcript(1100));
    await flush();
    expect(h.calls).toHaveLength(1); // waits a full interval after the failure

    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(1200));
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]?.prompt).toContain('[00:00.00-00:00.50]');
  });

  it('an empty reply is a failure, not an empty digest', async () => {
    const h = harness();
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(1000));
    await flush();
    h.calls[0]?.resolve('   ');
    await flush();
    expect(h.digest.current).toBeNull();
  });

  it('reset cancels the running update, drops its reply and clears the digest', async () => {
    const h = harness();
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(1000));
    await flush();
    h.calls[0]?.resolve('- Old take (00:05)');
    await flush();
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(2000));
    await flush();
    const running = h.calls[1];
    h.digest.reset();
    expect(running?.cancel.cancelled).toBe(true);
    expect(h.digest.current).toBeNull();
    running?.resolve('- Late reply (00:10)');
    await flush();
    expect(h.digest.current).toBeNull();
    expect(h.digest.inFlight).toBe(false);

    // The new take starts its own interval.
    h.digest.committed(transcript(1000));
    await flush();
    expect(h.calls).toHaveLength(2);
  });

  it('does nothing while no engine is available, and checks again only after an interval', async () => {
    const h = harness(null);
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(1000));
    await flush();
    h.digest.committed(transcript(1100));
    await flush();
    expect(h.calls).toHaveLength(0);
    expect(h.enabledReads()).toBe(1);
  });

  it('cuts the new lines to the engine input budget, keeping whole recent lines', async () => {
    const h = harness({ language: 'Spanish', maxInputChars: 500 });
    h.advance(DIGEST_INTERVAL_MS);
    h.digest.committed(transcript(4000));
    await flush();
    const prompt = h.calls[0]?.prompt ?? '';
    const section = prompt.slice(prompt.indexOf('New transcript lines:'));
    expect(section.length).toBeLessThan(600);
    expect(
      section
        .split('\n')
        .slice(1)
        .every((l) => l === '' || l.startsWith('[')),
    ).toBe(true);
    expect(prompt).toContain('in Spanish');
  });
});

describe('digest prompt and reply', () => {
  it('asks for short bullets with (mm:ss) times in the given language', () => {
    const prompt = buildDigestPrompt(null, line(5, 'Hello'), 'English');
    expect(prompt).toContain('(mm:ss)');
    expect(prompt).toContain('in English');
    expect(prompt).toContain('Previous summary:\n(none)');
    expect(prompt).toContain(String(DIGEST_MAX_CHARS));
  });

  it('cleans the reply: no code fences, capped at whole lines', () => {
    expect(cleanDigestReply('```\n- a (00:01)\n```')).toBe('- a (00:01)');
    const long = Array.from({ length: 60 }, (_, i) => `- point number ${i} (00:${i})`).join('\n');
    const cleaned = cleanDigestReply(long);
    expect(cleaned.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    expect(long.startsWith(cleaned)).toBe(true);
    expect(long.charAt(cleaned.length)).toBe('\n');
  });
});
