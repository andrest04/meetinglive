import { CancelSource, CancelledError, CliToolError } from '@vozella/core';
import { describe, expect, it } from 'vitest';
import {
  FAKE_SUMMARY_REPLY,
  FakeSummaryProvider,
  fakeSummaryOptionsFromEnv,
} from './fake-summary-provider';

const request = {
  transcript: 'Ana: hi',
  title: 'T',
  recordedAt: { ms: 0, offsetMinutes: 0 },
  outputLanguage: 'en',
} as never;

describe('FakeSummaryProvider', () => {
  it('answers the same three sections every time', async () => {
    const provider = new FakeSummaryProvider('codex');
    const result = await provider.summarize(request, new CancelSource().signal);
    expect(result.providerId).toBe('codex');
    expect(result.suggestedTitle).toBe('Fake planning meeting');
    expect(result.summaryMarkdown).toContain('Overview');
    expect(result.actionItems.map((item) => item.text)).toEqual([
      'Send the notes to the team',
      'Book the follow-up call',
    ]);
    expect(await provider.completePrompt('x', new CancelSource().signal)).toBe(FAKE_SUMMARY_REPLY);
  });

  it('fails with a CLI kind or as Unknown on request', async () => {
    const signedOut = new FakeSummaryProvider('local', { delayMs: 0, failWith: 'NotSignedIn' });
    await expect(signedOut.summarize(request, new CancelSource().signal)).rejects.toMatchObject({
      kind: 'NotSignedIn',
    });
    const odd = new FakeSummaryProvider('local', { delayMs: 0, failWith: 'boom' });
    const error = await odd.summarize(request, new CancelSource().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CliToolError);
    expect((error as CliToolError).kind).toBe('Unknown');
  });

  it('stops at once when cancelled during the delay', async () => {
    const provider = new FakeSummaryProvider('local', { delayMs: 5_000, failWith: null });
    const source = new CancelSource();
    const started = Date.now();
    const run = provider.summarize(request, source.signal);
    setTimeout(() => {
      source.cancel();
    }, 30);
    await expect(run).rejects.toBeInstanceOf(CancelledError);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('reads its options from the environment', () => {
    expect(fakeSummaryOptionsFromEnv({})).toEqual({ delayMs: 0, failWith: null });
    expect(
      fakeSummaryOptionsFromEnv({
        VOZELLA_FAKE_SUMMARY_DELAY_MS: '250',
        VOZELLA_FAKE_SUMMARY_FAIL: ' Unknown ',
      }),
    ).toEqual({ delayMs: 250, failWith: 'Unknown' });
  });
});
