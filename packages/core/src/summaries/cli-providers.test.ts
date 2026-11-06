import { describe, expect, it } from 'vitest';
import { CancelSource } from '../cancel';
import { parseOffsetDate } from '../library/offset-date';
import { CliTimeoutError, CliToolError } from './cli-failure';
import { InvalidCliOptionError } from './cli-invocation';
import { CLI_TIMEOUT_MS } from './cli-provider';
import {
  createClaudeCodeProvider,
  createClaudeCodeWebSearchProvider,
} from './claude-code-provider';
import { createCodexProvider, createCodexWebSearchProvider } from './codex-provider';
import { buildSummaryPrompt } from './prompt-builders';
import { CancelledError, isCancellation, type SummaryProvider } from './provider';
import { describeSummaryProviderContract } from './provider-contract';
import { FakeCliProcessRunner } from './test-kit';

const at = (text: string) => {
  const parsed = parseOffsetDate(text);
  if (!parsed) throw new Error(text);
  return parsed;
};
const recordedAt = at('2026-11-02T14:00:00.0000000-05:00');
const endedAt = at('2026-11-02T15:00:00.0000000-05:00');
const cancel = () => new CancelSource().signal;

const REPLY = `## Title
Budget review

## Summary
### What this was
Budget talk.

## Action Items
- [ ] Send it
`;

interface Flavor {
  readonly name: string;
  readonly id: 'claude-code' | 'codex';
  readonly executable: string;
  readonly displayName: string;
  readonly plainArgs: readonly string[];
  readonly make: (runner: FakeCliProcessRunner, timeoutMs?: number) => SummaryProvider;
  readonly makeWeb: (runner: FakeCliProcessRunner) => SummaryProvider;
  readonly makeWith: (
    runner: FakeCliProcessRunner,
    model: string,
    effort: string,
  ) => SummaryProvider;
  readonly configuredArgs: readonly string[];
}

const flavors: Flavor[] = [
  {
    name: 'Claude Code',
    id: 'claude-code',
    executable: 'claude',
    displayName: 'Claude Code',
    plainArgs: ['-p'],
    make: (r, timeoutMs) => createClaudeCodeProvider(r, { timeoutMs }),
    makeWeb: (r) => createClaudeCodeWebSearchProvider(r, { model: 'sonnet' }),
    makeWith: (r, model, effort) => createClaudeCodeProvider(r, { model, effort }),
    configuredArgs: ['-p', '--model', 'sonnet', '--effort', 'low'],
  },
  {
    name: 'Codex',
    id: 'codex',
    executable: 'codex',
    displayName: 'Codex',
    plainArgs: ['exec', '-'],
    make: (r, timeoutMs) => createCodexProvider(r, { timeoutMs }),
    makeWeb: (r) => createCodexWebSearchProvider(r, { model: 'gpt-5.6' }),
    makeWith: (r, model, effort) => createCodexProvider(r, { model, effort }),
    configuredArgs: ['exec', '-', '-m', 'gpt-5.6', '-c', 'model_reasoning_effort="low"'],
  },
];

for (const f of flavors) {
  describeSummaryProviderContract(
    f.name,
    (reply) => {
      const runner = new FakeCliProcessRunner(reply);
      return { provider: f.make(runner), sentPrompts: () => runner.sentPrompts() };
    },
    f.id,
  );

  describe(`${f.name} provider`, () => {
    const request = {
      transcript: 'We went over the budget.',
      title: 'Budget',
      recordedAt,
      endedAt,
      outputLanguage: 'en',
      enhancement: null,
    };

    it('runs the right executable with the prompt on stdin and returns trimmed stdout', async () => {
      const runner = new FakeCliProcessRunner('  answer \n');
      const out = await f.make(runner).completePrompt('Say hi', cancel());
      expect(out).toBe('answer');
      expect(runner.pathChecks).toEqual([f.executable]);
      expect(runner.calls).toEqual([
        { executable: f.executable, args: f.plainArgs, stdin: 'Say hi', timeoutMs: CLI_TIMEOUT_MS },
      ]);
    });

    it('uses a five minute timeout by default and an injected one when given', async () => {
      expect(CLI_TIMEOUT_MS).toBe(300_000);
      const runner = new FakeCliProcessRunner('x');
      await f.make(runner, 1234).completePrompt('p', cancel());
      expect(runner.calls[0]?.timeoutMs).toBe(1234);
    });

    it('passes model and effort as separate argv items', async () => {
      const runner = new FakeCliProcessRunner('x');
      const [model] = f.configuredArgs.filter((a) => a === 'sonnet' || a === 'gpt-5.6');
      await f.makeWith(runner, model ?? '', 'low').completePrompt('p', cancel());
      expect(runner.calls[0]?.args).toEqual(f.configuredArgs);
    });

    it('sends the whole summary prompt, with and without ended_at', async () => {
      const withEnd = new FakeCliProcessRunner(REPLY);
      await f.make(withEnd).summarize(request, cancel());
      expect(withEnd.calls[0]?.stdin).toBe(buildSummaryPrompt(request));
      expect(withEnd.calls[0]?.stdin).toContain('</ended_at>');
      const noEnd = new FakeCliProcessRunner(REPLY);
      await f.make(noEnd).summarize({ ...request, endedAt: null }, cancel());
      expect(noEnd.calls[0]?.stdin).not.toContain('</ended_at>');
    });

    it('asks for section headings in the output language by language code', async () => {
      const en = new FakeCliProcessRunner(REPLY);
      await f.make(en).summarize(request, cancel());
      expect(en.calls[0]?.stdin).toContain('with headings written in English.');
      const es = new FakeCliProcessRunner(REPLY);
      await f.make(es).summarize({ ...request, outputLanguage: 'es' }, cancel());
      expect(es.calls[0]?.stdin).toContain('with headings written in Spanish.');
    });

    it('sets the suggested title from the summary reply', async () => {
      const result = await f.make(new FakeCliProcessRunner(REPLY)).summarize(request, cancel());
      expect(result.suggestedTitle).toBe('Budget review');
      expect(result.providerId).toBe(f.id);
    });

    it('is plain by default and adds web search only from the explicit factory', async () => {
      const plain = new FakeCliProcessRunner('x');
      await f.make(plain).completePrompt('p', cancel());
      expect(plain.calls[0]?.args).not.toContain(f.id === 'codex' ? '--search' : '--tools');
      const web = new FakeCliProcessRunner('x');
      await f.makeWeb(web).completePrompt('p', cancel());
      const args = web.calls[0]?.args ?? [];
      if (f.id === 'codex') {
        expect(args[0]).toBe('--search');
        expect(args.indexOf('--search')).toBeLessThan(args.indexOf('exec'));
      } else {
        expect(args.slice(-4)).toEqual(['--tools', 'WebSearch', '--allowedTools', 'WebSearch']);
      }
    });

    it('throws NotInstalled with the display name and never spawns', async () => {
      const runner = new FakeCliProcessRunner('x');
      runner.onPath = false;
      const error = await f
        .make(runner)
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CliToolError);
      expect((error as CliToolError).kind).toBe('NotInstalled');
      expect((error as CliToolError).displayName).toBe(f.displayName);
      expect(runner.calls).toEqual([]);
    });

    it('classifies a non-zero exit', async () => {
      const runner = new FakeCliProcessRunner();
      runner.result = { exitCode: 1, stdout: '', stderr: 'Error: not logged in' };
      const error = await f
        .make(runner)
        .summarize(request, cancel())
        .catch((e: unknown) => e);
      expect((error as CliToolError).kind).toBe('NotSignedIn');
    });

    it('throws EmptyOutput for blank stdout with exit 0', async () => {
      const error = await f
        .make(new FakeCliProcessRunner('  \n'))
        .summarize(request, cancel())
        .catch((e: unknown) => e);
      expect((error as CliToolError).kind).toBe('EmptyOutput');
    });

    it('maps a runner timeout to TimedOut', async () => {
      const runner = new FakeCliProcessRunner();
      runner.fail = new CliTimeoutError();
      const error = await f
        .make(runner)
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect((error as CliToolError).kind).toBe('TimedOut');
    });

    it('never wraps a cancellation', async () => {
      const runner = new FakeCliProcessRunner();
      runner.fail = new CancelledError();
      const error = await f
        .make(runner)
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect(isCancellation(error)).toBe(true);
      expect(error).not.toBeInstanceOf(CliToolError);
    });

    it('refuses an unsafe model before any spawn', async () => {
      const runner = new FakeCliProcessRunner('x');
      const error = await f
        .makeWith(runner, 'a b; rm -rf /', 'low')
        .completePrompt('p', cancel())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidCliOptionError);
      expect(runner.calls).toEqual([]);
    });
  });
}
