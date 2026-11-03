import { describe, expect, it } from 'vitest';
import { SummaryError } from './cli-failure-messages';
import { CONTEXT_TOKENS, SAFETY_MARGIN, type TokenCounter } from './local-map-reduce';
import {
  fitTitlePrompt,
  MIN_PROMPT_REPLY,
  PROMPT_MAX_OUTPUT,
  promptOutputCap,
  TITLE_MAX_OUTPUT,
} from './local-prompt-budget';

const wordCounter: TokenCounter = {
  count: async (text) => text.split(/\s+/).filter((w) => w !== '').length + 1,
};
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const build = (transcript: string): string => `Name this recording. ${transcript}`;
const TITLE_LIMIT = CONTEXT_TOKENS - SAFETY_MARGIN - TITLE_MAX_OUTPUT;

describe('promptOutputCap (B9)', () => {
  it('caps a short prompt at 2048', async () => {
    expect(await promptOutputCap(wordCounter, words(10))).toBe(PROMPT_MAX_OUTPUT);
  });

  it('shrinks the cap to the room left after the prompt', async () => {
    const prompt = words(2500);
    const used = 2501;
    expect(await promptOutputCap(wordCounter, prompt)).toBe(CONTEXT_TOKENS - SAFETY_MARGIN - used);
  });

  it('refuses a prompt that leaves less than the minimum reply', async () => {
    const prompt = words(CONTEXT_TOKENS - SAFETY_MARGIN - MIN_PROMPT_REPLY + 5);
    await expect(promptOutputCap(wordCounter, prompt)).rejects.toMatchObject({
      code: 'PromptTooLong',
    });
  });

  it('accepts a prompt that leaves exactly the minimum reply', async () => {
    const prompt = words(CONTEXT_TOKENS - SAFETY_MARGIN - MIN_PROMPT_REPLY - 1);
    expect(await promptOutputCap(wordCounter, prompt)).toBe(MIN_PROMPT_REPLY);
  });
});

describe('fitTitlePrompt (B8)', () => {
  it('leaves a transcript that fits alone', async () => {
    const prompt = await fitTitlePrompt(wordCounter, build, words(100));
    expect(prompt).toBe(build(words(100)));
  });

  it('keeps the longest start of a long transcript that fits', async () => {
    const transcript = words(6000);
    const prompt = await fitTitlePrompt(wordCounter, build, transcript);
    expect(await wordCounter.count(prompt)).toBeLessThanOrEqual(TITLE_LIMIT);
    expect(prompt.startsWith('Name this recording. w0 w1')).toBe(true);
    // One more word would not fit.
    const kept = prompt.slice('Name this recording. '.length);
    const next = transcript.slice(0, kept.length + 6);
    expect(await wordCounter.count(build(next))).toBeGreaterThan(TITLE_LIMIT - 1);
  });

  it('never cuts a surrogate pair in half', async () => {
    const charCounter: TokenCounter = { count: async (text) => text.length + 1 };
    const emoji = '😀'.repeat(3000);
    for (const extra of [0, 1]) {
      const prompt = await fitTitlePrompt(
        { count: async (t) => charCounter.count(t.slice(extra)) },
        build,
        emoji,
      );
      const last = prompt.charCodeAt(prompt.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('throws PromptTooLong when even an empty transcript does not fit', async () => {
    const huge = (transcript: string): string => `${words(CONTEXT_TOKENS)} ${transcript}`;
    const error = await fitTitlePrompt(wordCounter, huge, 'hello').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SummaryError);
    expect((error as SummaryError).code).toBe('PromptTooLong');
  });
});
