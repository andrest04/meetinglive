import { recordingAnswer, recordingAnswerSchema, requestChannels } from '@vozella/contracts';
import { DIGEST_INTERVAL_MS, type Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { IpcMainLike } from '../ipc/ipc-server';
import { LiveAsk, registerLiveAskHandlers } from './live-ask-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event = { sender: { id: 1 }, senderFrame: { url: 'vozella://app/index.html', parent: null } };

function setup(
  recording = true,
  provider: string | null = 'Codex',
  extra: { now?: () => number; localModelLoaded?: () => boolean } = {},
) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const sent: { channel: string; payload: unknown }[] = [];
  const prompts: string[] = [];
  const resolved: { kind: string; webSearch: boolean }[] = [];
  const liveAsk = new LiveAsk({
    settings: {
      load: () =>
        Promise.resolve({ selectedSummaryProvider: provider, summaryLanguage: 'en' } as never),
    },
    resolver: {
      resolveSummaryProvider: (request) => {
        resolved.push({ kind: request?.kind ?? '', webSearch: request?.webSearch === true });
        return Promise.resolve({
          status: 'ready',
          kind: 'Codex',
          provider: {
            streamPrompt: async function* (prompt: string) {
              prompts.push(prompt);
              yield 'Because it ';
              yield 'does.';
            },
          },
        } as never);
      },
    },
    recording: () => ({ recording, title: 'Algebra', notes: 'ask about limits' }),
    broadcast: (channel, payload) => {
      sent.push({ channel: channel.name, payload });
    },
    formatFailure: String,
    nowMs: extra.now ?? (() => 0),
    ...(extra.localModelLoaded ? { localModelLoaded: extra.localModelLoaded } : {}),
  });
  registerLiveAskHandlers({ ipc, logger: logger(), isTrusted: () => true }, liveAsk);
  const call = (name: string, input: unknown): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    return Promise.resolve(handler(event as never, input)).then(
      (reply) => (reply as { value: unknown }).value,
    );
  };
  return { liveAsk, call, sent, prompts, resolved };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('live ask handlers', () => {
  it('registers the ask channels in the contract', () => {
    expect(Object.keys(requestChannels)).toEqual(
      expect.arrayContaining(['recording.ask', 'recording.cancelAsk']),
    );
    expect(recordingAnswer.name).toBe('recording.answer');
  });

  it('answers a typed question from the committed text and broadcasts the final answer', async () => {
    const t = setup();
    t.liveAsk.hooks.committed('[00:00.00-00:05.00] we talked about limits');
    const out = await t.call('recording.ask', { question: ' Why? ', webSearch: true });
    expect(out).toEqual({ accepted: true });
    await settle();
    expect(t.prompts[0]).toContain('we talked about limits');
    expect(t.prompts[0]).toContain('Meeting: Algebra');
    expect(t.resolved).toEqual([{ kind: 'Codex', webSearch: true }]);
    const last = t.sent[t.sent.length - 1];
    expect(last?.channel).toBe('recording.answer');
    expect(last?.payload).toMatchObject({
      text: 'Because it does.',
      usedWeb: true,
      isAnswering: false,
    });
  });

  it.each([[''], ['codex'], ['2'], [null]])(
    'B-20: a blank or unparsable provider (%s) is not chosen and never falls back to Local',
    async (provider) => {
      const t = setup(true, provider);
      await t.call('recording.ask', { question: 'Why?', webSearch: false });
      await settle();
      expect(t.resolved).toEqual([]);
      expect(t.prompts).toEqual([]);
      // 122: the user is told to pick a provider, not to open the app they are in.
      const last = t.sent[t.sent.length - 1];
      expect(last?.payload).toMatchObject({
        isAnswering: false,
        error: { key: 'Ui_LiveAnswerNoProvider' },
      });
    },
  );

  it('116: a preset question is routed through the preset path and answered', async () => {
    const t = setup();
    await t.call('recording.ask', { question: 'Summarize so far', webSearch: false, preset: true });
    await settle();
    expect(t.prompts[0]).toContain('Summarize so far');
  });

  it('refuses blank questions and asks outside a recording', async () => {
    const idle = setup(false);
    expect(await idle.call('recording.ask', { question: 'Why?', webSearch: false })).toEqual({
      accepted: false,
    });
    const rec = setup();
    expect(await rec.call('recording.ask', { question: '  ', webSearch: false })).toEqual({
      accepted: false,
    });
    expect(rec.sent).toHaveLength(0);
  });

  it('the hooks cancel an answer and a new take clears the committed text', async () => {
    const t = setup();
    t.liveAsk.hooks.committed('[00:00.00-00:05.00] old take');
    t.liveAsk.hooks.reset();
    await t.call('recording.ask', { question: 'Why?', webSearch: false });
    await settle();
    expect(t.prompts[0]).not.toContain('old take');
    t.liveAsk.hooks.cancel();
    expect(await t.call('recording.cancelAsk', {})).toEqual({ cancelled: false });
  });

  it('a preset chip is trimmed and asked through the typed path with the toggle', async () => {
    const t = setup();
    expect(
      await t.call('recording.ask', {
        question: '  What did I miss?  ',
        webSearch: false,
        preset: true,
      }),
    ).toEqual({ accepted: true });
    await settle();
    expect(t.prompts[0]).toContain('Question:\nWhat did I miss?\n');
    expect(t.resolved).toEqual([{ kind: 'Codex', webSearch: false }]);
  });

  it('a blank preset and a preset outside a take are no-ops', async () => {
    const rec = setup();
    expect(
      await rec.call('recording.ask', { question: ' \n', webSearch: false, preset: true }),
    ).toEqual({ accepted: false });
    const idle = setup(false);
    expect(
      await idle.call('recording.ask', { question: 'Explain', webSearch: false, preset: true }),
    ).toEqual({ accepted: false });
    expect(idle.sent).toHaveLength(0);
  });

  it('the web toggle of the last ask persists across a new take', async () => {
    const t = setup();
    await t.call('recording.ask', { question: 'a', webSearch: true });
    await settle();
    t.liveAsk.hooks.reset();
    expect(t.liveAsk.session.forceWebSearch).toBe(true);
    await t.call('recording.ask', { question: 'b', webSearch: true });
    await settle();
    expect(t.resolved.map((r) => r.webSearch)).toEqual([true, true]);
  });

  it('every answer state carries the fields the pill reads', async () => {
    const t = setup();
    await t.call('recording.ask', { question: 'Why?', webSearch: false });
    await settle();
    for (const sent of t.sent) {
      expect(recordingAnswerSchema.safeParse(sent.payload).success).toBe(true);
      expect(sent.channel).toBe('recording.answer');
    }
    expect(t.sent[t.sent.length - 1]?.payload).toMatchObject({
      canUseWebSearch: true,
      error: null,
    });
  });

  it('republish replays the last state for a window that opened late', async () => {
    const t = setup();
    await t.call('recording.ask', { question: 'Why?', webSearch: false });
    await settle();
    const count = t.sent.length;
    t.liveAsk.republish();
    expect(t.sent).toHaveLength(count + 1);
    expect(t.sent[count]?.payload).toEqual(t.sent[count - 1]?.payload);
  });
});

describe('live question detection', () => {
  const QUESTION = '¿Cuál es el tercer principio del manifesto ágil?';
  const line = (start: number, text: string): string =>
    `[00:${String(start).padStart(2, '0')}.00-00:${String(start + 4).padStart(2, '0')}.00] ${text}`;

  function questions(liveQuestions: string | null, reply = 'yes') {
    const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
    const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
    const sent: { channel: string; payload: unknown }[] = [];
    const checks: string[] = [];
    const liveAsk = new LiveAsk({
      settings: {
        load: () =>
          Promise.resolve({
            selectedSummaryProvider: 'ClaudeCode',
            summaryLanguage: 'es',
            liveQuestions,
          } as never),
      },
      resolver: {
        resolveSummaryProvider: () =>
          Promise.resolve({
            status: 'ready',
            kind: 'ClaudeCode',
            provider: {
              streamPrompt: async function* (prompt: string) {
                checks.push(prompt);
                await Promise.resolve();
                yield reply;
              },
            },
          } as never),
      },
      recording: () => ({ recording: true, title: 'Agile' }),
      broadcast: (channel, payload) => {
        sent.push({ channel: channel.name, payload });
      },
      formatFailure: String,
      nowMs: () => 0,
      schedule: (run) => {
        run();
      },
      setTimer: () => () => undefined,
    });
    registerLiveAskHandlers({ ipc, logger: logger(), isTrusted: () => true }, liveAsk);
    const call = (name: string, input: unknown): Promise<unknown> =>
      Promise.resolve(handlers.get(name)?.(event as never, input)).then(
        (reply) => (reply as { value: unknown }).value,
      );
    const on = (channel: string) => sent.filter((s) => s.channel === channel).map((s) => s.payload);
    return { liveAsk, sent, checks, call, on };
  }

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await settle();
  };

  it('emits a committed question once and never answers it on its own', async () => {
    const t = questions('rules');
    t.liveAsk.hooks.committed(line(0, QUESTION));
    t.liveAsk.hooks.committed(line(0, QUESTION));
    await flush();
    expect(t.on('recording.questionDetected')).toEqual([
      { id: expect.any(String) as string, body: QUESTION, atMs: 0, confirmed: true },
    ]);
    expect(t.on('recording.answer')).toEqual([]);
    expect(t.checks).toEqual([]);
  });

  it('rules+ai: shows the card at once, then confirms it through the summary engine', async () => {
    const t = questions(null, 'Yes');
    t.liveAsk.hooks.committed(line(0, QUESTION));
    await flush();
    expect(t.on('recording.questionDetected')).toEqual([
      expect.objectContaining({ confirmed: false }),
      expect.objectContaining({ confirmed: true }),
    ]);
    expect(t.checks[0]).toContain(QUESTION);
  });

  it('rules+ai: a "no" withdraws the card', async () => {
    const t = questions('rules+ai', 'no');
    t.liveAsk.hooks.committed(line(0, QUESTION));
    await flush();
    const [card] = t.on('recording.questionDetected') as { id: string }[];
    expect(t.on('recording.questionWithdrawn')).toEqual([{ id: card?.id }]);
  });

  it('a dismissed question leaves every window and does not return in the take', async () => {
    const t = questions('rules');
    t.liveAsk.hooks.committed(line(0, QUESTION));
    await flush();
    const [card] = t.on('recording.questionDetected') as { id: string }[];
    expect(await t.call('recording.dismissQuestion', { id: card?.id })).toEqual({
      dismissed: true,
    });
    expect(t.on('recording.questionWithdrawn')).toEqual([{ id: card?.id }]);
    t.liveAsk.hooks.committed([line(0, QUESTION), line(10, QUESTION)].join('\n'));
    await flush();
    expect(t.on('recording.questionDetected')).toHaveLength(1);
    expect(await t.call('recording.dismissQuestion', { id: 'q-unknown' })).toEqual({
      dismissed: false,
    });
  });

  it('a new take withdraws the card and lets the same question count again', async () => {
    const t = questions('rules');
    t.liveAsk.hooks.committed(line(0, QUESTION));
    await flush();
    t.liveAsk.hooks.reset();
    expect(t.on('recording.questionWithdrawn')).toHaveLength(1);
    t.liveAsk.hooks.committed(line(0, QUESTION));
    await flush();
    expect(t.on('recording.questionDetected')).toHaveLength(2);
  });

  it('off: nothing is detected', async () => {
    const t = questions('off');
    t.liveAsk.hooks.committed(line(0, QUESTION));
    await flush();
    expect(t.on('recording.questionDetected')).toEqual([]);
  });
});

describe('rolling digest (T2)', () => {
  const lines = (count: number): string =>
    Array.from(
      { length: count },
      (_, i) =>
        `[00:${String(i).padStart(2, '0')}.00-00:${String(i).padStart(2, '0')}.50] we keep talking about the budget for the quarter`,
    ).join('\n');

  it('updates the digest through the selected engine and exposes it with the session context', async () => {
    let now = 0;
    const t = setup(true, 'Codex', { now: () => now });
    t.liveAsk.hooks.reset();
    now = DIGEST_INTERVAL_MS;
    t.liveAsk.hooks.committed(lines(20));
    await settle();
    await settle();
    expect(t.prompts.some((p) => p.includes('running summary'))).toBe(true);
    expect(t.liveAsk.chatContext()).toEqual({
      digest: 'Because it does.',
      title: 'Algebra',
      notes: 'ask about limits',
    });
    t.liveAsk.hooks.cancel();
    expect(t.liveAsk.chatContext().digest).toBeNull();
  });

  it('never loads the local model for a digest', async () => {
    let now = 0;
    let loaded = false;
    const t = setup(true, 'Local', { now: () => now, localModelLoaded: () => loaded });
    t.liveAsk.hooks.reset();
    now = DIGEST_INTERVAL_MS;
    t.liveAsk.hooks.committed(lines(20));
    await settle();
    expect(t.resolved).toEqual([]);
    expect(t.liveAsk.chatContext().digest).toBeNull();

    loaded = true;
    now = 2 * DIGEST_INTERVAL_MS;
    t.liveAsk.hooks.committed(lines(30));
    await settle();
    await settle();
    expect(t.resolved).toEqual([{ kind: 'Local', webSearch: false }]);
    expect(t.liveAsk.chatContext().digest).toBe('Because it does.');
  });
});
