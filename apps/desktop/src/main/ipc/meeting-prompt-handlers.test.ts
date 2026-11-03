import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { IpcEventLike } from '../security/trusted-origin';
import type { IpcMainLike } from './ipc-server';
import { registerMeetingPromptHandlers } from './meeting-prompt-handlers';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event: IpcEventLike = {
  sender: { id: 9 },
  senderFrame: { url: 'vozella://app/meeting-prompt.html', parent: null },
};

function setup(trusted = true) {
  const handlers = new Map<string, (event: never, ...args: unknown[]) => unknown>();
  const ipc: IpcMainLike = { handle: (name, listener) => void handlers.set(name, listener) };
  const actions = {
    startTakingNotes: vi.fn(),
    dismiss: vi.fn(),
    neverAgain: vi.fn(() => Promise.resolve()),
  };
  registerMeetingPromptHandlers({ ipc, isTrusted: () => trusted, logger: logger() }, actions);
  const call = async (name: string) => await handlers.get(name)?.(event as never, {});
  return { actions, call };
}

describe('meeting prompt handlers', () => {
  it('routes the three popup buttons to the controller', async () => {
    const t = setup();
    expect(await t.call('meetingPrompt.start')).toEqual({ ok: true, value: { done: true } });
    expect(await t.call('meetingPrompt.dismiss')).toEqual({ ok: true, value: { done: true } });
    expect(await t.call('meetingPrompt.neverAgain')).toEqual({ ok: true, value: { done: true } });
    expect(t.actions.startTakingNotes).toHaveBeenCalledTimes(1);
    expect(t.actions.dismiss).toHaveBeenCalledTimes(1);
    expect(t.actions.neverAgain).toHaveBeenCalledTimes(1);
  });

  it('ignores an untrusted sender', async () => {
    const t = setup(false);
    const result = (await t.call('meetingPrompt.start')) as { ok: boolean };
    expect(result.ok).toBe(false);
    expect(t.actions.startTakingNotes).not.toHaveBeenCalled();
  });
});
