import { requestChannels, type RequestName } from '@vozella/contracts';
import type {
  ChatMessage,
  ChatScopeDecision,
  ChatSendOutcome,
  ChatState,
  Logger,
} from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import {
  allowedExternalUrl,
  ChatController,
  chatProviderSource,
  type ChatServicePort,
} from '../chat/chat-controller';
import type { IpcEventLike } from '../security/trusted-origin';
import { registerChatHandlers } from './chat-handlers';
import type { IpcMainLike } from './ipc-server';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};

const SCOPE = { isVisible: true, kind: 'AllMeetings', folderId: null, meetingId: null } as const;
const WHEN = new Date('2026-01-01T10:00:00.000Z');
const message = (id: string, role: 'user' | 'assistant', text: string): ChatMessage => ({
  id,
  role,
  text,
  createdAt: WHEN,
});

/** A service double: the test scripts what a send streams and answers. */
class FakeChatService implements ChatServicePort {
  sendCalls: { draft: string; scope: ChatScopeDecision; live: string | null }[] = [];
  chunks: string[] = [];
  outcome: (draft: string) => ChatSendOutcome = (draft) => ({
    status: 'sent',
    user: message('u1', 'user', draft),
    assistant: message('a1', 'assistant', this.chunks.at(-1) ?? ''),
  });
  hold: Promise<void> | null = null;
  cancelled = 0;
  private sending = false;
  private pending: ChatState['pending'] = null;
  private messages: readonly ChatMessage[] = [];
  private mismatch = false;
  private readonly listeners = new Set<() => void>();
  private generation = 0;

  get state(): ChatState {
    return {
      messages: this.messages,
      isSending: this.sending,
      pending: this.pending,
      showScopeMismatch: this.mismatch,
      hasMessages: this.messages.length > 0 || this.pending !== null,
      canStartNewChat: !this.sending,
    };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginScopeRefresh(): number {
    this.generation += 1;
    return this.generation;
  }

  applyScope(token: number, decision: ChatScopeDecision): boolean {
    if (token !== this.generation) return false;
    this.mismatch = decision.kind === 'Live';
    this.notify();
    return true;
  }

  newChat(): boolean {
    if (this.sending) return false;
    this.messages = [];
    this.notify();
    return true;
  }

  cancel(): void {
    this.cancelled += 1;
    this.sending = false;
  }

  async send(
    draft: string,
    scope: ChatScopeDecision,
    live: string | null,
  ): Promise<ChatSendOutcome> {
    this.sendCalls.push({ draft, scope, live });
    this.sending = true;
    this.pending = { userText: draft, assistantText: '' };
    this.notify();
    for (const text of this.chunks) {
      this.pending = { userText: draft, assistantText: text };
      this.notify();
    }
    if (this.hold !== null) await this.hold;
    const outcome = this.outcome(draft);
    if (outcome.status === 'sent')
      this.messages = [...this.messages, outcome.user, outcome.assistant];
    this.sending = false;
    this.pending = null;
    this.notify();
    return outcome;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function setup(options: { findMeetingId?: (id: string) => Promise<string | null> } = {}) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const service = new FakeChatService();
  const events: { name: string; payload: unknown }[] = [];
  const clipboard: string[] = [];
  const opened: string[] = [];
  const controller = new ChatController({
    service,
    findMeetingId: options.findMeetingId ?? (() => Promise.resolve(null)),
    writeClipboard: (text) => {
      if (text === 'boom') return Promise.reject(new Error('clipboard busy'));
      clipboard.push(text);
      return Promise.resolve();
    },
    openExternal: (url) => {
      if (url.includes('fail.test')) return Promise.reject(new Error('no browser'));
      opened.push(url);
      return Promise.resolve();
    },
    broadcast: (channel, payload) => events.push({ name: channel.name, payload }),
    logger: logger(),
  });
  registerChatHandlers({
    server: { ipc, logger: logger(), isTrusted: () => true },
    controller,
  });
  const call = async (name: RequestName, input: unknown): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    return handler(event as never, input);
  };
  return { call, service, events, clipboard, opened, handlers };
}

const ok = (value: unknown): unknown => (value as { ok: boolean; value: unknown }).value;
const sendInput = (over: Record<string, unknown> = {}) => ({
  requestId: 'r1',
  draft: 'What did we decide?',
  scope: SCOPE,
  liveTranscript: null,
  ...over,
});

describe('chat handlers', () => {
  it('registers every chat request channel', () => {
    const { handlers } = setup();
    const expected = Object.keys(requestChannels).filter((name) => name.startsWith('chat.'));
    expect(expected).toHaveLength(8);
    for (const name of expected) expect(handlers.has(name)).toBe(true);
  });

  it('send forwards the chunks in order tagged with the request id, then answers', async () => {
    const { call, service, events } = setup();
    service.chunks = ['We', 'We decided', 'We decided to ship'];
    const result = ok(await call('chat.send', sendInput()));
    expect(result).toMatchObject({
      status: 'answered',
      user: { id: 'u1', role: 'user', text: 'What did we decide?' },
      assistant: { id: 'a1', role: 'assistant', text: 'We decided to ship' },
    });
    expect(events.filter((e) => e.name === 'chat.chunk').map((e) => e.payload)).toEqual([
      { requestId: 'r1', text: 'We' },
      { requestId: 'r1', text: 'We decided' },
      { requestId: 'r1', text: 'We decided to ship' },
    ]);
  });

  it('passes the scope and the live transcript snapshot to the service as sent (item 21)', async () => {
    const { call, service } = setup();
    await call(
      'chat.send',
      sendInput({
        scope: { isVisible: true, kind: 'Live', folderId: null, meetingId: null },
        liveTranscript: 'Ana: we ship on Friday',
      }),
    );
    expect(service.sendCalls).toEqual([
      {
        draft: 'What did we decide?',
        scope: { isVisible: true, kind: 'Live', folderId: null, meetingId: null },
        live: 'Ana: we ship on Friday',
      },
    ]);
  });

  it('a setup-required send is a value that carries the kind and the draft', async () => {
    const { call, service } = setup();
    service.outcome = (draft) => ({
      status: 'setup-required',
      kind: 'Local',
      originalDraft: draft,
    });
    expect(ok(await call('chat.send', sendInput()))).toEqual({
      status: 'setup-required',
      kind: 'Local',
      originalDraft: 'What did we decide?',
    });
  });

  it('failed, cancelled and ignored sends map to their values', async () => {
    const { call, service } = setup();
    service.outcome = (draft) => ({
      status: 'failed',
      failure: { kind: 'send-failed', message: 'Could not answer.' },
      originalDraft: draft,
    });
    expect(ok(await call('chat.send', sendInput()))).toEqual({
      status: 'failed',
      kind: 'send-failed',
      message: 'Could not answer.',
      originalDraft: 'What did we decide?',
    });
    service.outcome = (draft) => ({ status: 'cancelled', originalDraft: draft });
    expect(ok(await call('chat.send', sendInput()))).toEqual({
      status: 'cancelled',
      originalDraft: 'What did we decide?',
    });
    service.outcome = () => ({ status: 'ignored' });
    expect(ok(await call('chat.send', sendInput()))).toEqual({ status: 'empty' });
  });

  it('a service that throws still answers a failed value with the draft', async () => {
    const { call, service } = setup();
    service.outcome = () => {
      throw new Error('bug');
    };
    expect(ok(await call('chat.send', sendInput()))).toMatchObject({
      status: 'failed',
      originalDraft: 'What did we decide?',
    });
  });

  it('cancel stops a running send and says whether one was running', async () => {
    const { call, service } = setup();
    expect(ok(await call('chat.cancel', {}))).toEqual({ cancelled: false });
    let release: () => void = () => undefined;
    service.hold = new Promise((resolve) => {
      release = resolve;
    });
    service.outcome = (draft) => ({ status: 'cancelled', originalDraft: draft });
    const running = call('chat.send', sendInput());
    await Promise.resolve();
    expect(ok(await call('chat.cancel', {}))).toEqual({ cancelled: true });
    release();
    expect(ok(await running)).toMatchObject({ status: 'cancelled' });
    expect(service.cancelled).toBe(2);
  });

  it('new chat is refused while sending and clears the thread otherwise', async () => {
    const { call, service } = setup();
    await call('chat.send', sendInput());
    expect((ok(await call('chat.state', {})) as { hasMessages: boolean }).hasMessages).toBe(true);
    let release: () => void = () => undefined;
    service.hold = new Promise((resolve) => {
      release = resolve;
    });
    const running = call('chat.send', sendInput());
    await Promise.resolve();
    expect(ok(await call('chat.newChat', {}))).toEqual({ started: false });
    release();
    await running;
    service.hold = null;
    expect(ok(await call('chat.newChat', {}))).toEqual({ started: true });
    expect((ok(await call('chat.state', {})) as { hasMessages: boolean }).hasMessages).toBe(false);
  });

  it('setScope applies the scope and a state change reaches every window once', async () => {
    const { call, events } = setup();
    const state = ok(
      await call('chat.setScope', {
        scope: { isVisible: true, kind: 'Live', folderId: null, meetingId: null },
      }),
    ) as { showScopeMismatch: boolean };
    expect(state.showScopeMismatch).toBe(true);
    expect(events.filter((e) => e.name === 'chat.stateChanged')).toHaveLength(1);
    await call('chat.setScope', {
      scope: { isVisible: true, kind: 'Live', folderId: null, meetingId: null },
    });
    expect(events.filter((e) => e.name === 'chat.stateChanged')).toHaveLength(1);
  });

  it('meetingExists answers the stored id, and a failing lookup is not a crash', async () => {
    const found = setup({ findMeetingId: () => Promise.resolve('3f2b8c1e-9a47') });
    expect(ok(await found.call('chat.meetingExists', { meetingId: '3f2b8c1e9a47' }))).toEqual({
      exists: true,
      meetingId: '3f2b8c1e-9a47',
    });
    const missing = setup();
    expect(ok(await missing.call('chat.meetingExists', { meetingId: 'abc' }))).toEqual({
      exists: false,
      meetingId: null,
    });
    const broken = setup({ findMeetingId: () => Promise.reject(new Error('disk')) });
    expect(ok(await broken.call('chat.meetingExists', { meetingId: 'abc' }))).toEqual({
      exists: false,
      meetingId: null,
    });
  });

  it('copyText writes the clipboard and reports a failure as a value', async () => {
    const { call, clipboard } = setup();
    expect(ok(await call('chat.copyText', { text: '**raw** markdown' }))).toEqual({
      status: 'written',
    });
    expect(clipboard).toEqual(['**raw** markdown']);
    expect(ok(await call('chat.copyText', { text: 'boom' }))).toEqual({
      status: 'failed',
      detail: 'clipboard busy',
    });
  });

  it('openExternal opens http and https only (S2)', async () => {
    const { call, opened } = setup();
    expect(ok(await call('chat.openExternal', { url: 'https://example.com/a?b=1' }))).toEqual({
      status: 'opened',
    });
    expect(ok(await call('chat.openExternal', { url: 'http://example.com' }))).toEqual({
      status: 'opened',
    });
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:privacy',
      'vozella://meeting/abc',
      'mailto:a@b.test',
      'not a url',
    ]) {
      expect(ok(await call('chat.openExternal', { url }))).toEqual({ status: 'rejected' });
    }
    expect(opened).toEqual(['https://example.com/a?b=1', 'http://example.com/']);
    expect(ok(await call('chat.openExternal', { url: 'https://fail.test/' }))).toEqual({
      status: 'failed',
      detail: 'no browser',
    });
  });

  it('rejects input that breaks the contract before the controller sees it', async () => {
    const { call, service } = setup();
    const result = (await call('chat.send', sendInput({ requestId: '' }))) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(service.sendCalls).toHaveLength(0);
  });
});

describe('allowedExternalUrl', () => {
  it('keeps http and https and drops everything else', () => {
    expect(allowedExternalUrl(' https://a.test/x ')).toBe('https://a.test/x');
    expect(allowedExternalUrl('HTTP://A.test')).toBe('http://a.test/');
    expect(allowedExternalUrl('ftp://a.test')).toBeNull();
    expect(allowedExternalUrl('//a.test')).toBeNull();
  });
});

describe('chatProviderSource', () => {
  it('maps the summaries gate: ready, needs setup, removed', async () => {
    const provider = {
      streamPrompt: () =>
        (async function* () {
          yield 'x';
        })(),
    };
    const source = (gate: unknown) =>
      chatProviderSource({ resolveSummaryProvider: () => Promise.resolve(gate as never) });
    expect(await source({ status: 'ready', kind: 'Local', provider }).resolve()).toEqual({
      status: 'ready',
      provider,
    });
    expect(
      await source({ status: 'needs-setup', kind: 'Codex', reason: 'cli-missing' }).resolve(),
    ).toEqual({ status: 'needs-setup', kind: 'Codex' });
    expect(
      await source({ status: 'unavailable', kind: 'Xai', reason: 'xai-removed' }).resolve(),
    ).toEqual({ status: 'unavailable' });
  });
});
