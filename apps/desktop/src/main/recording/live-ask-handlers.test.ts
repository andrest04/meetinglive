import { recordingAnswer, recordingAnswerSchema, requestChannels } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { IpcMainLike } from '../ipc/ipc-server';
import { LiveAsk, registerLiveAskHandlers } from './live-ask-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event = { sender: { id: 1 }, senderFrame: { url: 'vozella://app/index.html', parent: null } };

function setup(recording = true, provider: string | null = 'Codex') {
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
    recording: () => ({ recording, title: 'Algebra' }),
    broadcast: (channel, payload) => {
      sent.push({ channel: channel.name, payload });
    },
    formatFailure: String,
    nowMs: () => 0,
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
    },
  );

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
