import { describe, expect, it } from 'vitest';
import { CancelSource } from '../cancel';
import { parseOffsetDate } from '../library/offset-date';
import { SummaryError } from './cli-failure-messages';
import {
  CONTEXT_TOKENS,
  FINAL_MAX_OUTPUT,
  NOTES_MAX_OUTPUT,
  SAFETY_MARGIN,
  groupToBudget,
  splitLongLine,
  splitToBudget,
  summarizeMapReduce,
  type InferFunction,
  type TokenCounter,
} from './local-map-reduce';
import { createEnhancementContext } from './prompt-builders';
import { CancelledError, type SummarizeRequest } from './provider';

const recordedAt = parseOffsetDate('2026-11-02T14:00:00.0000000-05:00')!;
const NEVER = new CancelSource().signal;

/** Predictable counter: whitespace-separated words plus one for BOS, like the C# fake. */
const wordCounter: TokenCounter = {
  count: async (text) => text.split(/\s+/).filter((w) => w !== '').length + 1,
};
/** Characters plus BOS: forces splitting inside words, surrogate pairs included. */
const charCounter: TokenCounter = {
  count: async (text) => text.length + 1,
};

const request = (transcript: string, over: Partial<SummarizeRequest> = {}): SummarizeRequest => ({
  title: 'Weekly sync',
  recordedAt,
  transcript,
  outputLanguage: 'en',
  ...over,
});

const lines = (count: number, wordsPerLine: number): string =>
  Array.from({ length: count }, (_, i) =>
    Array.from({ length: wordsPerLine }, (_, j) => `w${i}x${j}`).join(' '),
  ).join('\n');

const words = (count: number, tag: string): string =>
  Array.from({ length: count }, (_, i) => `${tag}${i}`).join(' ');

interface Call {
  prompt: string;
  maxTokens: number;
  temperature: number;
}
function recorder(reply: (call: Call, index: number) => string = () => '- a note') {
  const calls: Call[] = [];
  const infer: InferFunction = async (prompt, maxTokens, temperature) => {
    const call = { prompt, maxTokens, temperature };
    calls.push(call);
    return reply(call, calls.length - 1);
  };
  return { calls, infer };
}

const partBody = (prompt: string): string =>
  /<transcript_part>\n([\s\S]*)\n<\/transcript_part>$/.exec(prompt)![1]!;
const isPart = (c: Call): boolean => c.prompt.startsWith('You take notes on part');
const isMerge = (c: Call): boolean => c.prompt.startsWith('These are consecutive notes');

async function expectAllFit(calls: readonly Call[], label = ''): Promise<void> {
  for (const call of calls) {
    const room =
      CONTEXT_TOKENS - SAFETY_MARGIN - call.maxTokens - (await wordCounter.count(call.prompt));
    expect(room, label).toBeGreaterThanOrEqual(0);
  }
}

describe('summarizeMapReduce', () => {
  it('goes through in one call when the prompt fits', async () => {
    const { calls, infer } = recorder(() => 'RAW');
    const out = await summarizeMapReduce(request('short talk'), wordCounter, infer, NEVER);
    expect(out).toBe('RAW');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ maxTokens: 1024, temperature: 0.3 });
    expect(calls[0]!.prompt).toContain('<transcript>\nshort talk\n</transcript>');
  });

  it('keeps every prompt inside the context for a long transcript', async () => {
    const { calls, infer } = recorder();
    await summarizeMapReduce(request(lines(400, 25)), wordCounter, infer, NEVER);
    expect(calls.length).toBeGreaterThan(2);
    await expectAllFit(calls);
  });

  it('loses no transcript line', async () => {
    const transcript = lines(300, 25);
    const { calls, infer } = recorder();
    await summarizeMapReduce(request(transcript), wordCounter, infer, NEVER);
    const joined = calls
      .filter(isPart)
      .map((c) => partBody(c.prompt))
      .join('\n');
    expect(joined).toBe(transcript);
  });

  it('numbers parts from 1 in order and ends with the full final prompt at 1024', async () => {
    const enhancement = createEnhancementContext({
      rawNotes: 'My own notes',
      agenda: 'Agenda item',
    });
    const { calls, infer } = recorder(() => '- note');
    await summarizeMapReduce(request(lines(300, 25), { enhancement }), wordCounter, infer, NEVER);
    const parts = calls.filter(isPart);
    parts.forEach((c, i) => {
      expect(c.prompt).toContain(`part ${i + 1} of ${parts.length} of an automatic`);
      expect(c.maxTokens).toBe(NOTES_MAX_OUTPUT);
      expect(c.temperature).toBe(0.3);
    });
    const last = calls[calls.length - 1]!;
    expect(last.maxTokens).toBe(FINAL_MAX_OUTPUT);
    expect(last.prompt).toContain('# Identity');
    expect(last.prompt).toContain('My own notes');
    expect(last.prompt).toContain('Agenda item');
    expect(last.prompt).toContain('<transcript>\n- note');
  });

  it('merges notes that do not fit, within budget', async () => {
    const big = words(600, 'n');
    const { calls, infer } = recorder((call) => (isMerge(call) ? '- merged' : big));
    await summarizeMapReduce(request(lines(800, 25)), wordCounter, infer, NEVER);
    expect(calls.filter(isMerge).length).toBeGreaterThan(0);
    await expectAllFit(calls);
    expect(calls[calls.length - 1]!.maxTokens).toBe(FINAL_MAX_OUTPUT);
  });

  it('splits a line longer than a chunk without losing words', async () => {
    const all = words(5000, 'v');
    const { calls, infer } = recorder();
    await summarizeMapReduce(request(all), wordCounter, infer, NEVER);
    const seen = calls.filter(isPart).flatMap((c) => partBody(c.prompt).split(/\s+/));
    expect(seen.filter(Boolean)).toEqual(all.split(' '));
  });

  it('stops before the next call when cancelled', async () => {
    const source = new CancelSource();
    let n = 0;
    const infer: InferFunction = async () => {
      n++;
      source.cancel();
      return '- note';
    };
    await expect(
      summarizeMapReduce(request(lines(300, 25)), wordCounter, infer, source.signal),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(n).toBe(1);
  });

  it('refuses a signal cancelled before the start', async () => {
    const early = new CancelSource();
    early.cancel();
    const { calls, infer } = recorder();
    await expect(
      summarizeMapReduce(request('x'), wordCounter, infer, early.signal),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(calls).toHaveLength(0);
  });

  it('checks cancellation before the final call', async () => {
    const transcript = lines(300, 25);
    const probe = recorder();
    await summarizeMapReduce(request(transcript), wordCounter, probe.infer, NEVER);
    const partCount = probe.calls.filter(isPart).length;
    expect(partCount).toBeGreaterThan(1);

    const source = new CancelSource();
    let n = 0;
    const infer: InferFunction = async () => {
      n++;
      if (n === partCount) source.cancel(); // the last part ends, then the final call is next
      return '- n';
    };
    await expect(
      summarizeMapReduce(request(transcript), wordCounter, infer, source.signal),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(n).toBe(partCount);
  });

  it('fails before any inference when the transcript has too many parts', async () => {
    const { calls, infer } = recorder();
    const error = await summarizeMapReduce(
      request(lines(20000, 25)),
      wordCounter,
      infer,
      NEVER,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SummaryError);
    expect((error as SummaryError).code).toBe('TranscriptTooLong');
    expect((error as SummaryError).args[0]).toBeGreaterThan(64);
    expect((error as SummaryError).args[1]).toBe(64);
    expect(calls).toHaveLength(0);
  });

  it('fails before any inference when supplied notes leave no room', async () => {
    const enhancement = createEnhancementContext({ rawNotes: words(4000, 'k') });
    const { calls, infer } = recorder();
    const error = await summarizeMapReduce(
      request(lines(50, 25), { enhancement }),
      wordCounter,
      infer,
      NEVER,
    ).catch((e: unknown) => e);
    expect((error as SummaryError).code).toBe('NotesTooLong');
    expect(calls).toHaveLength(0);
  });

  it('surfaces the error of a failing chunk', async () => {
    const infer: InferFunction = async () => {
      throw new Error('boom');
    };
    await expect(
      summarizeMapReduce(request(lines(300, 25)), wordCounter, infer, NEVER),
    ).rejects.toThrow('boom');
  });

  it('stops with CannotCondense when no two notes can share a merge prompt', async () => {
    const { calls, infer } = recorder(() => words(2000, 'h'));
    const error = await summarizeMapReduce(
      request(lines(800, 25)),
      wordCounter,
      infer,
      NEVER,
    ).catch((e: unknown) => e);
    expect((error as SummaryError).code).toBe('CannotCondense');
    expect(calls.some(isMerge)).toBe(false);
  });

  it('passes single-note groups through without a call', async () => {
    let first = true;
    const { calls, infer } = recorder((call) => {
      if (!isPart(call)) return '- merged';
      const note = first ? words(3220, 's') : words(50, 'tiny');
      first = false;
      return note;
    });
    await summarizeMapReduce(request(lines(800, 25)), wordCounter, infer, NEVER);
    // Pass 0: the big first note is alone in its group and goes through; the small ones merge.
    // Pass 1: the big note and the merged one share a group and are merged in one call.
    const merges = calls.filter(isMerge);
    expect(merges).toHaveLength(2);
    expect(merges[0]!.prompt).not.toContain('s3219');
    expect(merges[0]!.prompt).toContain('tiny49');
    expect(merges[1]!.prompt).toContain('s3219');
    expect(calls[calls.length - 1]!.maxTokens).toBe(FINAL_MAX_OUTPUT);
  });
});

describe('splitToBudget', () => {
  it('keeps lines together, in order', async () => {
    // each line "a b" costs 3 + 1 = 4
    expect(await splitToBudget(wordCounter, 'a b\nc d\ne f\ng h', 8)).toEqual([
      'a b\nc d',
      'e f\ng h',
    ]);
  });

  it('drops whitespace-only chunks and keeps empty lines inside a chunk', async () => {
    expect(await splitToBudget(wordCounter, '   \n\t', 100)).toEqual([]);
    expect(await splitToBudget(wordCounter, 'a\n\nb', 100)).toEqual(['a\n\nb']);
  });

  it('splits CRLF lines and rejoins with LF', async () => {
    expect(await splitToBudget(wordCounter, 'a\r\nb', 100)).toEqual(['a\nb']);
  });

  it('keeps every character when there is no whitespace', async () => {
    const text = 'x'.repeat(1000);
    const chunks = await splitToBudget(charCounter, text, 101);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks)
      expect((await charCounter.count(chunk)) + 1).toBeLessThanOrEqual(101);
  });

  it('never splits a surrogate pair', async () => {
    const text = '😀'.repeat(300);
    for (const budget of [5, 6, 7, 11, 12]) {
      const chunks = await splitToBudget(charCounter, text, budget);
      expect(chunks.join('')).toBe(text);
      for (const chunk of chunks) {
        const first = chunk.charCodeAt(0);
        const last = chunk.charCodeAt(chunk.length - 1);
        expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
        expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      }
    }
  });

  it('flushes the buffer before a long line and always makes progress', async () => {
    const chunks = await splitToBudget(charCounter, 'ab\n' + 'z'.repeat(50), 6);
    expect(chunks[0]).toBe('ab');
    expect(chunks.join('')).toBe('ab' + 'z'.repeat(50));
    expect(await splitLongLine({ count: async () => 99 }, 'abc', 1)).toEqual(['a', 'b', 'c']);
  });

  it('prefers whitespace in the second half of a piece', async () => {
    const pieces = await splitLongLine(charCounter, 'aaaaa bbbbb ccccc', 9);
    expect(pieces[0]).toBe('aaaaa ');
    expect(pieces.join('')).toBe('aaaaa bbbbb ccccc');
  });
});

describe('groupToBudget', () => {
  it('costs tokens plus two and keeps an oversized note alone', async () => {
    // costs 5, 5, 11, 4 against a budget of 12
    const groups = await groupToBudget(wordCounter, ['a b', 'c d', 'e f g h i j k l', 'm'], 12);
    expect(groups).toEqual([['a b', 'c d'], ['e f g h i j k l'], ['m']]);
  });
});

describe('properties (items 50 and 51)', () => {
  function rng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  const randomTranscript = (rand: () => number): string => {
    const lineCount = 1 + Math.floor(rand() * 120);
    return Array.from({ length: lineCount }, () => {
      const kind = rand();
      const count = kind < 0.1 ? 3000 : kind < 0.2 ? 0 : 1 + Math.floor(rand() * 60);
      return Array.from({ length: count }, () => `t${Math.floor(rand() * 5000)}`).join(
        rand() < 0.1 ? '  ' : ' ',
      );
    }).join(rand() < 0.5 ? '\n' : '\r\n');
  };

  it('every prompt fits and every word survives, for 40 random transcripts', async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const transcript = randomTranscript(rng(seed));
      const { calls, infer } = recorder();
      try {
        await summarizeMapReduce(request(transcript), wordCounter, infer, NEVER);
      } catch (e) {
        expect(e).toBeInstanceOf(SummaryError);
        continue;
      }
      await expectAllFit(calls, `seed ${seed}`);
      const parts = calls.filter(isPart);
      if (parts.length > 0) {
        const seen = parts.flatMap((c) => partBody(c.prompt).split(/\s+/).filter(Boolean));
        expect(seen, `seed ${seed}`).toEqual(transcript.split(/\s+/).filter(Boolean));
      }
    }
  });

  it('keeps every non-whitespace character with a character counter and emoji', async () => {
    const alphabet = ['a', 'b', ' ', '😀', 'é', '\n', '中'];
    for (let seed = 1; seed <= 30; seed++) {
      const rand = rng(seed * 7);
      const text = Array.from(
        { length: 800 },
        () => alphabet[Math.floor(rand() * alphabet.length)]!,
      ).join('');
      const budget = 8 + Math.floor(rand() * 40);
      const chunks = await splitToBudget(charCounter, text, budget);
      const strip = (s: string): string => s.replace(/\s+/g, '');
      expect(strip(chunks.join('')), `seed ${seed}`).toBe(strip(text));
      for (const chunk of chunks) expect((await charCounter.count(chunk)) <= budget).toBe(true);
    }
  });
});
