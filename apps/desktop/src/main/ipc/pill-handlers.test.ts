import type { PillStateDto } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { IpcEventLike } from '../security/trusted-origin';
import type { IpcMainLike } from './ipc-server';
import { registerPillHandlers } from './pill-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 9 },
  senderFrame: { url: 'vozella://app/pill.html', parent: null },
};
const state: PillStateDto = {
  visible: true,
  expanded: false,
  edge: 'Right',
  vertical: true,
  animationsEnabled: true,
  opacity: 1,
  contentOpacity: 1,
  window: { width: 80, height: 256 },
  capsule: { x: 8, y: 8, width: 64, height: 240 },
  panel: null,
};

function setup(trusted = true) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const actions = {
    togglePause: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    openApp: vi.fn(),
    setExpanded: vi.fn((): PillStateDto => state),
    state: vi.fn((): PillStateDto => state),
  };
  registerPillHandlers({ ipc, isTrusted: () => trusted, logger: logger() }, actions);
  const call = async (name: string, input: unknown = {}) =>
    await handlers.get(name)?.(event as never, input);
  return { actions, call };
}

describe('pill handlers', () => {
  it('routes pause, stop and open app to the actions', async () => {
    const t = setup();
    expect(await t.call('pill.togglePause')).toEqual({ ok: true, value: { done: true } });
    expect(await t.call('pill.stop')).toEqual({ ok: true, value: { done: true } });
    expect(await t.call('pill.openApp')).toEqual({ ok: true, value: { done: true } });
    expect(t.actions.togglePause).toHaveBeenCalledTimes(1);
    expect(t.actions.stop).toHaveBeenCalledTimes(1);
    expect(t.actions.openApp).toHaveBeenCalledTimes(1);
  });

  it('answers the state in force after setExpanded and on ready', async () => {
    const t = setup();
    expect(await t.call('pill.setExpanded', { expanded: true })).toEqual({
      ok: true,
      value: state,
    });
    expect(t.actions.setExpanded).toHaveBeenCalledWith(true);
    expect(await t.call('pill.ready')).toEqual({ ok: true, value: state });
  });

  it('rejects an input of the wrong shape and an untrusted sender', async () => {
    const t = setup();
    const bad = (await t.call('pill.setExpanded', { expanded: 'yes' })) as { ok: boolean };
    expect(bad.ok).toBe(false);
    const untrusted = setup(false);
    const result = (await untrusted.call('pill.stop')) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(untrusted.actions.stop).not.toHaveBeenCalled();
  });
});
