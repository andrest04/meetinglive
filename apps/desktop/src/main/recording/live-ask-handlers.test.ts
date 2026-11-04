import { recordingAnswer, requestChannels } from '@vozella/contracts';
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
});
