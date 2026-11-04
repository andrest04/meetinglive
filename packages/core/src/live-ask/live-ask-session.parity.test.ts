import { describe, expect, it } from 'vitest';
import type { CancelSignal } from '../cancel';
import type { SummaryProviderKind } from '../library/settings';
import { CancelledError } from '../summaries/provider';
import { LiveAskSession, type LiveAnswerState, type LiveAskDeps } from './live-ask-session';

/** Live copilot parity rows 105-127: the ask state machine against the spec (2.9, 3.8). */

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

interface Held {
  release(): void;
  readonly promise: Promise<void>;
}
const held = (): Held => {
  let release = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
};

function rig(
  options: {
    kind?: () => SummaryProviderKind;
    stream?: (prompt: string, cancel: CancelSignal) => AsyncIterable<string>;
    committed?: () => string;
    context?: () => { title: string; brief: string };
  } = {},
) {
  const published: LiveAnswerState[] = [];
  const prompts: string[] = [];
  const webFlags: boolean[] = [];
  let now = 0;
  const deps: LiveAskDeps = {
    loadSettings: async () => ({ providerKind: options.kind?.() ?? 'ClaudeCode', language: 'en' }),
    resolveProvider: async ({ webSearch }) => {
      webFlags.push(webSearch);
      return {
        status: 'ready',
        provider: {
          streamPrompt: (prompt, cancel) => {
            prompts.push(prompt);
            return (
              options.stream ??
              async function* () {
                yield 'ok';
              }
            )(prompt, cancel);
          },
        },
      };
    },
    committedText: options.committed ?? (() => '[00:00.00-00:10.00] hello'),
    sessionContext: options.context ?? (() => ({ title: '', brief: '' })),
    publish: (s) => published.push(s),
    nowMs: () => now,
    formatFailure: (e) => `failed: ${(e as Error).message}`,
    setupWired: false,
  };
  const session = new LiveAskSession(deps);
  return {
    session,
    published,
    prompts,
    webFlags,
    last: () => published[published.length - 1],
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('LiveAskSession generations (items 105-108, 126, 127)', () => {
  it('a late chunk of a superseded ask never publishes, and the older one stays silent', async () => {
    const gate = held();
    const t = rig({
      stream: async function* (prompt) {
        if (prompt.includes('Question:\nold\n')) {
          yield 'OLD1';
          await gate.promise;
          yield 'OLD2';
        } else {
          yield 'NEW';
        }
      },
    });
    const first = t.session.ask('old');
    await flush();
    expect(t.last()?.text).toBe('OLD1');
    await t.session.ask('new');
    gate.release();
    await first;
    expect(t.published.map((s) => s.text)).not.toContain('OLD2');
    expect(t.last()).toMatchObject({ text: 'NEW', isAnswering: false, error: null });
  });

  it('a newer ask aborts the older provider signal without an error', async () => {
    let firstSignal: CancelSignal | null = null;
    const gate = held();
    const t = rig({
      stream: async function* (prompt, cancel) {
        if (prompt.includes('Question:\none\n')) {
          firstSignal = cancel;
          await gate.promise;
          throw new CancelledError();
        }
        yield 'two';
      },
    });
    const first = t.session.ask('one');
    await flush();
    await t.session.ask('two');
    expect((firstSignal as CancelSignal | null)?.cancelled).toBe(true);
    gate.release();
    await first;
    expect(t.published.every((s) => s.error === null)).toBe(true);
  });

  it('Stop and Discard (cancel) end answering once and drop the late text', async () => {
    const gate = held();
    const t = rig({
      stream: async function* () {
        yield 'part';
        await gate.promise;
        yield 'late';
      },
    });
    const run = t.session.ask('q');
    await flush();
    t.session.cancel();
    expect(t.last()).toMatchObject({ isAnswering: false });
    gate.release();
    await run;
    expect(t.published.map((s) => s.text)).not.toContain('partlate');
    expect(t.last()?.error).toBeNull();
  });

  it('cancel while idle publishes nothing', () => {
    const t = rig();
    t.session.cancel();
    expect(t.published).toHaveLength(0);
  });

  it('a new take (reset) cancels the answer in flight and clears every answer field', async () => {
    const gate = held();
    const t = rig({
      stream: async function* () {
        yield 'part';
        await gate.promise;
        yield 'late';
      },
    });
    const run = t.session.ask('q');
    await flush();
    t.session.reset();
    await flush();
    gate.release();
    await run;
    expect(t.last()).toMatchObject({
      isAnswering: false,
      text: '',
      error: null,
      usedWeb: false,
      canUseWebSearch: true,
    });
  });

  it('a failed ask does not poison the next one', async () => {
    let fail = true;
    const t = rig({
      stream: async function* () {
        if (fail) throw new Error('first');
        yield 'fine';
      },
    });
    await t.session.ask('a');
    expect(t.last()?.error).toEqual({ key: null, text: 'failed: first' });
    fail = false;
    await t.session.ask('b');
    expect(t.last()).toMatchObject({ text: 'fine', error: null });
  });
});

describe('LiveAskSession typed path (items 105, 116; bugs 1-3)', () => {
  it('trims the question and a blank question does nothing', async () => {
    const t = rig();
    await t.session.ask('   \n ');
    expect(t.published).toHaveLength(0);
    await t.session.ask('  What now?\n');
    expect(t.prompts[0]).toContain('Question:\nWhat now?\n\nTranscript window:');
  });

  // Bugs 1 to 3 lived in the shared text box and the armed slot, which are gone. The ask takes
  // its question as an argument, so an earlier question can never shadow a later one.
  it('each ask uses only its own question; nothing leaks from the previous one', async () => {
    const t = rig();
    await t.session.ask('first typed question');
    await t.session.ask('second');
    expect(t.prompts[1]).toContain('Question:\nsecond\n');
    expect(t.prompts[1]).not.toContain('first typed question');
  });

  it('the prompt reads the live committed text and the title at ask time', async () => {
    let text = '[00:00.00-00:10.00] one';
    const t = rig({ committed: () => text, context: () => ({ title: 'Algebra', brief: '' }) });
    await t.session.ask('q');
    text = '[00:00.00-00:10.00] one\n[00:10.00-00:20.00] two';
    await t.session.ask('q');
    expect(t.prompts[0]).not.toContain('two');
    expect(t.prompts[1]).toContain('two');
    expect(t.prompts[1]).toContain('Session context:\nMeeting: Algebra');
  });
});

describe('LiveAskSession web policy (items 112-115, bug 15)', () => {
  it('the toggle survives reset while answer, error and usedWeb clear', async () => {
    const t = rig({ kind: () => 'Codex' });
    t.session.setForceWebSearch(true);
    await t.session.ask('q');
    expect(t.last()?.usedWeb).toBe(true);
    t.session.reset();
    await flush();
    expect(t.session.forceWebSearch).toBe(true);
    expect(t.last()).toMatchObject({ text: '', error: null, usedWeb: false });
    await t.session.ask('again');
    expect(t.webFlags).toEqual([true, true]);
  });

  it('web is off when the toggle is off, even on a CLI provider', async () => {
    const t = rig({ kind: () => 'ClaudeCode' });
    await t.session.ask('q');
    expect(t.webFlags).toEqual([false]);
    expect(t.prompts[0]?.toLowerCase()).not.toContain('web');
    expect(t.last()).toMatchObject({ usedWeb: false, canUseWebSearch: true });
  });

  it('Local never searches, whatever the toggle says', async () => {
    const t = rig({ kind: () => 'Local' });
    t.session.setForceWebSearch(true);
    await t.session.ask('q');
    expect(t.webFlags).toEqual([false]);
  });

  it('canUseWebSearch is refreshed on every ask', async () => {
    let kind: SummaryProviderKind = 'ClaudeCode';
    const t = rig({ kind: () => kind });
    await t.session.ask('a');
    expect(t.last()?.canUseWebSearch).toBe(true);
    kind = 'Local';
    await t.session.ask('b');
    expect(t.last()?.canUseWebSearch).toBe(false);
  });

  it('refreshWebSupport publishes when the provider changed mid-take and stays quiet otherwise', async () => {
    let kind: SummaryProviderKind = 'Codex';
    const t = rig({ kind: () => kind });
    t.session.reset();
    await flush();
    expect(t.last()?.canUseWebSearch).toBe(true);
    const count = t.published.length;
    await t.session.refreshWebSupport();
    expect(t.published).toHaveLength(count);
    kind = 'Local';
    await t.session.refreshWebSupport();
    expect(t.last()?.canUseWebSearch).toBe(false);
  });

  it('a refresh keeps the answer that is on screen', async () => {
    let kind: SummaryProviderKind = 'Codex';
    const t = rig({ kind: () => kind });
    await t.session.ask('q');
    kind = 'Local';
    await t.session.refreshWebSupport();
    expect(t.last()).toMatchObject({ text: 'ok', canUseWebSearch: false });
  });

  it('a settings failure in refresh is swallowed', async () => {
    const t = rig({
      kind: () => {
        throw new Error('disk');
      },
    });
    await expect(t.session.refreshWebSupport()).resolves.toBeUndefined();
    expect(t.published).toHaveLength(0);
  });

  it('republish sends the current state again', async () => {
    const t = rig();
    await t.session.ask('q');
    const count = t.published.length;
    t.session.republish();
    expect(t.published).toHaveLength(count + 1);
    expect(t.last()).toBe(t.session.current);
  });
});

describe('LiveAskSession streaming (item 119, spec 3.8)', () => {
  it('shows nothing for whitespace-only chunks, then the first visible chunk at once, trimmed at the start', async () => {
    const t = rig({
      stream: async function* () {
        yield '\n';
        yield '   ';
        yield '  Hello';
      },
    });
    await t.session.ask('q');
    // asking, toggle refreshed, first visible chunk, final answer
    expect(t.published.map((s) => s.text)).toEqual(['', '', 'Hello', 'Hello']);
    expect(t.published[2]?.isAnswering).toBe(true);
  });

  it('later chunks wait for 80 ms, 79 ms is not enough, and every flush trims the start', async () => {
    const t = rig({
      stream: async function* () {
        yield ' a';
        t.advance(79);
        yield 'b';
        t.advance(1);
        yield 'c';
        yield 'd';
      },
    });
    await t.session.ask('q');
    expect(t.published.map((s) => s.text)).toEqual(['', '', 'a', 'abc', 'abcd']);
    expect(t.published.slice(0, 4).map((s) => s.isAnswering)).toEqual([true, true, true, true]);
    expect(t.last()?.isAnswering).toBe(false);
  });

  it('the final answer is trimmed on both ends and flags usedWeb', async () => {
    const t = rig({
      kind: () => 'ClaudeCode',
      stream: async function* () {
        yield '\n  The answer.  \n';
      },
    });
    t.session.setForceWebSearch(true);
    await t.session.ask('q');
    expect(t.last()).toMatchObject({ text: 'The answer.', usedWeb: true, isAnswering: false });
  });

  it('a throw before any visible text shows the failure and no partial answer', async () => {
    const t = rig({
      stream: async function* () {
        yield ' ';
        throw new Error('cli exited');
      },
    });
    await t.session.ask('q');
    expect(t.last()).toMatchObject({
      text: '',
      isAnswering: false,
      error: { key: null, text: 'failed: cli exited' },
    });
  });
});
