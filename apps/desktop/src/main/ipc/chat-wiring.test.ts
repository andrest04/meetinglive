import { requestChannels, type RequestName } from '@vozella/contracts';
import { ChatService, type ChatMeetingReader, type Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { ChatController } from '../chat/chat-controller';
import type { IpcEventLike } from '../security/trusted-origin';
import { registerChatHandlers } from './chat-handlers';
import type { IpcMainLike } from './ipc-server';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};
const scope = (kind: string) => ({ isVisible: true, kind, folderId: null, meetingId: null });

const reader: ChatMeetingReader = {
  meetingById: () => Promise.resolve(null),
  meetingsInFolder: () => Promise.resolve([]),
  listRecent: () => Promise.resolve([]),
  listFolders: () => Promise.resolve([]),
};

/** The real ChatService behind the real controller and handlers; only the edges are doubles. */
function wire() {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const events: { name: string; payload: unknown }[] = [];
  let id = 0;
  const service = new ChatService({
    meetings: reader,
    providers: {
      resolve: () =>
        Promise.resolve({
          status: 'ready',
          provider: {
            streamPrompt: async function* () {
              yield 'ok';
            },
          },
        }),
    },
    clock: { now: () => new Date('2026-01-01T00:00:00.000Z'), nowMs: () => 0 } as never,
    translate: (key: string) => key,
    newId: () => `id-${String((id += 1))}`,
  });
  const controller = new ChatController({
    service,
    findMeetingId: () => Promise.resolve(null),
    writeClipboard: () => Promise.resolve(),
    openExternal: () => Promise.resolve(),
    broadcast: (channel, payload) => events.push({ name: channel.name, payload }),
    logger: logger(),
  });
  registerChatHandlers({ server: { ipc, logger: logger(), isTrusted: () => true }, controller });
  const call = async (name: RequestName, input: unknown): Promise<unknown> => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`no handler for ${name}`);
    return handler(event as never, input);
  };
  return { call, events };
}

describe('chat scope mismatch through the real service (B24)', () => {
  it('shows the banner after a scope change, broadcasts it, and clears it on New chat', async () => {
    expect(Object.keys(requestChannels)).toContain('chat.setScope');
    const { call, events } = wire();
    await call('chat.send', {
      requestId: 'r1',
      draft: 'hello',
      scope: scope('AllMeetings'),
      liveTranscript: null,
    });
    const before = (await call('chat.setScope', { scope: scope('AllMeetings') })) as {
      value: { showScopeMismatch: boolean };
    };
    expect(before.value.showScopeMismatch).toBe(false);

    const after = (await call('chat.setScope', { scope: scope('Live') })) as {
      value: { showScopeMismatch: boolean };
    };
    expect(after.value.showScopeMismatch).toBe(true);
    const last = events.filter((e) => e.name === 'chat.stateChanged').at(-1);
    expect(
      (last?.payload as { state: { showScopeMismatch: boolean } }).state.showScopeMismatch,
    ).toBe(true);

    await call('chat.newChat', {});
    const cleared = (await call('chat.state', {})) as { value: { showScopeMismatch: boolean } };
    expect(cleared.value.showScopeMismatch).toBe(false);
  });
});
