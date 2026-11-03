import { describe, expect, it, vi } from 'vitest';
import { createApi, type ClientTransport } from './api';
import { appFocusChanged, appGetInfo, appReportRendererError } from './channels';
import { IpcError } from './result';
import { callRequest, prepareEvent, receiveEvent, serveRequest } from './wire';

const info = {
  name: 'Vozella',
  version: '0.0.0',
  electron: '45.2.1',
  chrome: '1',
  node: '24',
  platform: 'win32',
  arch: 'x64',
  isPackaged: false,
  fakeNative: true,
  dataRoot: { appData: 'a', meetings: 'm', source: 'env' as const },
};

describe('serveRequest', () => {
  it('returns the validated handler value', async () => {
    const serve = serveRequest(appGetInfo, () => info);
    expect(await serve({})).toEqual({ ok: true, value: info });
  });

  it('rejects invalid input without calling the handler', async () => {
    const handler = vi.fn(() => info);
    const serve = serveRequest(appGetInfo, handler);
    const result = await serve({ extra: 1 });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects an invalid handler output', async () => {
    const onError = vi.fn();
    const serve = serveRequest(appGetInfo, () => ({ ...info, version: 1 }) as never, onError);
    expect(await serve({})).toMatchObject({ ok: false, error: { code: 'invalid-output' } });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('hides the message of a thrown error', async () => {
    const onError = vi.fn();
    const serve = serveRequest(
      appGetInfo,
      () => {
        throw new Error('C:\\secret\\path');
      },
      onError,
    );
    const result = await serve({});
    expect(result).toEqual({
      ok: false,
      error: { code: 'handler-failed', message: 'app.getInfo failed' },
    });
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('callRequest', () => {
  it('validates input before sending', async () => {
    const send = vi.fn();
    await expect(
      callRequest(appReportRendererError, { message: 'x', source: 'nope' } as never, send),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(send).not.toHaveBeenCalled();
  });

  it('round-trips through a server', async () => {
    const serve = serveRequest(appGetInfo, () => info);
    const result = await callRequest(appGetInfo, {}, (_name, input) => serve(input));
    expect(result).toEqual(info);
  });

  it('throws IpcError for a failure result', async () => {
    const failure = callRequest(appGetInfo, {}, async () => ({
      ok: false,
      error: { code: 'untrusted-sender', message: 'no' },
    }));
    await expect(failure).rejects.toBeInstanceOf(IpcError);
    await expect(failure).rejects.toMatchObject({ code: 'untrusted-sender' });
  });

  it('rejects an output that does not match the schema', async () => {
    const failure = callRequest(appGetInfo, {}, async () => ({ ok: true, value: { name: 1 } }));
    await expect(failure).rejects.toMatchObject({ code: 'invalid-output' });
  });

  it('rejects a malformed envelope', async () => {
    await expect(callRequest(appGetInfo, {}, async () => 'nope')).rejects.toMatchObject({
      code: 'invalid-output',
    });
  });
});

describe('events', () => {
  it('validates on both ends', () => {
    expect(prepareEvent(appFocusChanged, { focused: true })).toEqual({ focused: true });
    expect(() => prepareEvent(appFocusChanged, { focused: 'yes' } as never)).toThrow(IpcError);

    const listener = vi.fn();
    const onInvalid = vi.fn();
    receiveEvent(appFocusChanged, { focused: false }, listener, onInvalid);
    receiveEvent(appFocusChanged, { focused: 5 }, listener, onInvalid);
    expect(listener).toHaveBeenCalledExactlyOnceWith({ focused: false });
    expect(onInvalid).toHaveBeenCalledOnce();
  });
});

describe('createApi', () => {
  it('wires invoke and on over a transport', async () => {
    const serve = serveRequest(appGetInfo, () => info);
    let emit: (raw: unknown) => void = () => undefined;
    const transport: ClientTransport = {
      send: (_name, input) => serve(input),
      subscribe: (_name, listener) => {
        emit = listener;
        return () => undefined;
      },
    };
    const api = createApi(transport);
    expect(await api.invoke('app.getInfo', {})).toEqual(info);

    const listener = vi.fn();
    api.on('app.focusChanged', listener);
    emit({ focused: true });
    expect(listener).toHaveBeenCalledWith({ focused: true });
  });

  it('rejects unknown channels', async () => {
    const api = createApi({ send: async () => undefined, subscribe: () => () => undefined });
    await expect(api.invoke('nope' as never, {} as never)).rejects.toThrow(/unknown/);
  });
});
