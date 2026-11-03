import { describe, expect, it } from 'vitest';
import { CancelSource } from '../cancel';
import { parseOffsetDate } from '../library/offset-date';
import { buildSummaryPrompt, buildTitlePrompt } from './prompt-builders';
import { PROVIDER_IDS, isCancellation, type SummaryProvider } from './provider';
import { splitSummaryResponse } from './summary-splitter';

/**
 * A provider wired to a scripted model. `sentPrompts` is every prompt that reached the model, in
 * order, so the contract can prove which builder produced it and how many inferences ran.
 */
export interface ContractHarness {
  readonly provider: SummaryProvider;
  readonly sentPrompts: () => readonly string[];
}

/** Creates a harness whose model answers every prompt with `reply`. */
export type ContractHarnessFactory = (reply: string) => ContractHarness;

const at = (text: string) => {
  const parsed = parseOffsetDate(text);
  if (!parsed) throw new Error(text);
  return parsed;
};

const REPLY = `## Title
Budget review

## Summary
### What this was
The team reviewed the budget.

## Action Items
- [ ] Send the budget to finance
- [x] Book the review room
`;

/**
 * The behavior every `SummaryProvider` shares (spec 2.1): the prompt is the shared builder's, the
 * reply goes through the shared splitter, the title comes from the same reply, and streaming
 * concatenates to the complete answer. Reused by the Claude Code, Codex and local provider tests.
 */
export function describeSummaryProviderContract(
  name: string,
  create: ContractHarnessFactory,
  expectedId: (typeof PROVIDER_IDS)[number],
): void {
  const recordedAt = at('2026-11-02T14:00:00.0000000-05:00');
  const endedAt = at('2026-11-02T15:00:00.0000000-05:00');
  const request = {
    transcript: 'We went over the budget line by line.',
    title: 'Budget',
    recordedAt,
    endedAt,
    outputLanguage: 'en',
    enhancement: null,
  };

  describe(`${name} honors the summary provider contract`, () => {
    it('has a known provider id', () => {
      const { provider } = create(REPLY);
      expect(provider.id).toBe(expectedId);
      expect(PROVIDER_IDS).toContain(provider.id);
    });

    it('summarize sends the shared summary prompt once and splits the reply with the shared splitter', async () => {
      const { provider, sentPrompts } = create(REPLY);
      const result = await provider.summarize(request, new CancelSource().signal);
      const split = splitSummaryResponse(REPLY);
      expect(sentPrompts()).toEqual([buildSummaryPrompt(request)]);
      expect(result).toEqual({
        summaryMarkdown: split.summaryMarkdown,
        actionItems: split.actionItems,
        providerId: expectedId,
        suggestedTitle: 'Budget review',
      });
      expect(result.actionItems).toEqual([
        { text: 'Send the budget to finance', isDone: false },
        { text: 'Book the review room', isDone: true },
      ]);
    });

    it('takes the suggested title from the same response, with no second inference', async () => {
      const { provider, sentPrompts } = create(REPLY);
      const result = await provider.summarize(request, new CancelSource().signal);
      expect(result.suggestedTitle).toBe('Budget review');
      expect(sentPrompts()).toHaveLength(1);
    });

    it('suggestTitle sends the shared title prompt and returns the raw reply', async () => {
      const { provider, sentPrompts } = create('Budget review');
      const raw = await provider.suggestTitle(
        { transcript: request.transcript, recordedAt, outputLanguage: 'en' },
        new CancelSource().signal,
      );
      expect(raw).toBe('Budget review');
      expect(sentPrompts()).toEqual([buildTitlePrompt(request.transcript, recordedAt, 'en')]);
    });

    it('completePrompt sends the prompt as given', async () => {
      const { provider, sentPrompts } = create('answer');
      expect(await provider.completePrompt('Say hi', new CancelSource().signal)).toBe('answer');
      expect(sentPrompts()).toContain('Say hi');
    });

    it('streamPrompt chunks concatenate to the complete answer', async () => {
      const full = create('The full answer.').provider;
      const expected = await full.completePrompt('Question', new CancelSource().signal);
      const streaming = create('The full answer.').provider;
      let joined = '';
      for await (const chunk of streaming.streamPrompt('Question', new CancelSource().signal)) {
        joined += chunk;
      }
      expect(joined).toBe(expected);
    });

    it('a signal cancelled before the call rejects as a cancellation and sends nothing', async () => {
      const { provider, sentPrompts } = create(REPLY);
      const source = new CancelSource();
      source.cancel();
      const error = await provider.summarize(request, source.signal).catch((e: unknown) => e);
      expect(isCancellation(error)).toBe(true);
      expect(sentPrompts()).toEqual([]);
    });
  });
}
