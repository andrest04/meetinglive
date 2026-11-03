import { describe, expect, it } from 'vitest';
import type { CancelSignal } from '../cancel';
import { CancelSource } from '../cancel';
import { buildSummaryPrompt } from './prompt-builders';
import { describeSummaryProviderContract } from './provider-contract';
import {
  CancelledError,
  PROVIDER_IDS,
  isCancellation,
  summaryResultFromResponse,
  throwIfCancelled,
  withDefaultStream,
  type SummarizeRequest,
  type SummaryProvider,
} from './provider';

/** A reference provider: builds with the shared builders, answers from a scripted model. */
function referenceProvider(reply: string): { provider: SummaryProvider; prompts: string[] } {
  const prompts: string[] = [];
  const completePrompt = async (prompt: string, cancel: CancelSignal): Promise<string> => {
    throwIfCancelled(cancel);
    prompts.push(prompt);
    return reply;
  };
  const provider: SummaryProvider = {
    id: 'codex',
    summarize: async (request: SummarizeRequest, cancel) =>
      summaryResultFromResponse('codex', await completePrompt(buildSummaryPrompt(request), cancel)),
    completePrompt,
    streamPrompt: withDefaultStream(completePrompt),
  };
  return { provider, prompts };
}

describeSummaryProviderContract(
  'the reference provider',
  (reply) => {
    const { provider, prompts } = referenceProvider(reply);
    return { provider, sentPrompts: () => prompts };
  },
  'codex',
);

describe('provider ids', () => {
  it('are local, claude-code and codex only (xAI is retired)', () => {
    expect([...PROVIDER_IDS]).toEqual(['local', 'claude-code', 'codex']);
  });
});

describe('withDefaultStream', () => {
  it('yields the whole answer as one chunk', async () => {
    const stream = withDefaultStream(async () => 'hello world');
    const chunks: string[] = [];
    for await (const chunk of stream('p', new CancelSource().signal)) chunks.push(chunk);
    expect(chunks).toEqual(['hello world']);
  });

  it('lets a failure from the underlying call reach the reader', async () => {
    const stream = withDefaultStream(async () => {
      throw new Error('boom');
    });
    const read = async () => {
      for await (const chunk of stream('p', new CancelSource().signal)) expect(chunk).toBeDefined();
    };
    await expect(read()).rejects.toThrow('boom');
  });
});

describe('summaryResultFromResponse', () => {
  it('splits sections and keeps the provider id', () => {
    const result = summaryResultFromResponse(
      'local',
      '## Title\nSprint plan\n\n## Summary\nBody\n\n## Action Items\n- [ ] Ship it\n',
    );
    expect(result.providerId).toBe('local');
    expect(result.suggestedTitle).toBe('Sprint plan');
    expect(result.summaryMarkdown).toBe('Body');
    expect(result.actionItems).toEqual([{ text: 'Ship it', isDone: false }]);
  });

  it('gives a null title when the reply has none', () => {
    expect(summaryResultFromResponse('codex', 'Just a body').suggestedTitle).toBeNull();
  });
});

describe('cancellation', () => {
  it('is recognized by name and not confused with other errors', () => {
    expect(isCancellation(new CancelledError())).toBe(true);
    expect(isCancellation(new Error('x'))).toBe(false);
    expect(isCancellation('x')).toBe(false);
  });

  it('throwIfCancelled only throws once cancelled', () => {
    const source = new CancelSource();
    expect(() => throwIfCancelled(source.signal)).not.toThrow();
    source.cancel();
    expect(() => throwIfCancelled(source.signal)).toThrow(CancelledError);
  });
});
