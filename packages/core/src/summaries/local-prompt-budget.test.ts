import { describe, expect, it } from 'vitest';
import { CONTEXT_TOKENS, SAFETY_MARGIN, type TokenCounter } from './local-map-reduce';
import { MIN_PROMPT_REPLY, PROMPT_MAX_OUTPUT, promptOutputCap } from './local-prompt-budget';

const wordCounter: TokenCounter = {
  count: async (text) => text.split(/\s+/).filter((w) => w !== '').length + 1,
};
const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

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
