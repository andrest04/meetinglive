import { appFocusChanged, appGetInfo, diagnosticsNativeSelfTest } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { IpcEventLike } from '../security/trusted-origin';
import { registerRequest, sendEvent, type IpcMainLike } from './ipc-server';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function fakeIpc() {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  };
  const call = (name: string, event: IpcEventLike, ...args: unknown[]) =>
    handlers.get(name)?.(event as never, ...args);
  return { ipc, call };
}

const event: IpcEventLike = {
  sender: { id: 1 },
  senderFrame: { url: 'vozella://app/index.html', parent: null },
};

describe('registerRequest', () => {
  it('rejects untrusted senders before touching the handler', async () => {
    const { ipc, call } = fakeIpc();
    const handler = vi.fn(() => ({ backend: 'fake' as const, platformSupported: true }));
    registerRequest(
      { ipc, isTrusted: () => false, logger: logger() },
      diagnosticsNativeSelfTest,
      handler,
    );
    expect(await call('diagnostics.nativeSelfTest', event, {})).toMatchObject({
      ok: false,
      error: { code: 'untrusted-sender' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('validates input and output for trusted senders', async () => {
    const { ipc, call } = fakeIpc();
    const handler = vi.fn(() => ({ backend: 'fake' as const, platformSupported: true }));
    registerRequest(
      { ipc, isTrusted: () => true, logger: logger() },
      diagnosticsNativeSelfTest,
      handler,
    );
    expect(await call('diagnostics.nativeSelfTest', event, { nope: 1 })).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
    expect(await call('diagnostics.nativeSelfTest', event, {})).toEqual({
      ok: true,
      value: { backend: 'fake', platformSupported: true },
    });
  });

  it('logs handler errors and sends only a generic failure', async () => {
    const { ipc, call } = fakeIpc();
    const log = logger();
    registerRequest({ ipc, isTrusted: () => true, logger: log }, appGetInfo, () => {
      throw new Error('C:\\private');
    });
    const result = await call('app.getInfo', event, {});
    expect(JSON.stringify(result)).not.toContain('private');
    expect(log.error).toHaveBeenCalled();
  });
});

describe('sendEvent', () => {
  it('validates the payload and skips destroyed targets', () => {
    const send = vi.fn();
    sendEvent({ send, isDestroyed: () => false }, appFocusChanged, { focused: true });
    expect(send).toHaveBeenCalledWith('app.focusChanged', { focused: true });

    expect(() =>
      sendEvent({ send, isDestroyed: () => false }, appFocusChanged, { focused: 1 } as never),
    ).toThrow();

    send.mockClear();
    sendEvent({ send, isDestroyed: () => true }, appFocusChanged, { focused: true });
    expect(send).not.toHaveBeenCalled();
  });
});
