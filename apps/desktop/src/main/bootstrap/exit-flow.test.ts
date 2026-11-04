import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { ExitFlow } from './exit-flow';

const logger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const event = () => ({ preventDefault: vi.fn() });

function build(mayExit: () => Promise<boolean>) {
  const log = logger();
  const quit = vi.fn();
  const closeWindow = vi.fn();
  const flow = new ExitFlow({ mayExit, quit, closeWindow, logger: log });
  return { flow, quit, closeWindow, log };
}

describe('ExitFlow (97, 99, 100)', () => {
  it('holds the quit, asks the gate and quits once approved', async () => {
    const t = build(() => Promise.resolve(true));
    const e = event();
    expect(t.flow.beforeQuit(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(t.quit).toHaveBeenCalledOnce();
    });
    // The quit it triggered passes without asking again (100).
    const again = event();
    expect(t.flow.beforeQuit(again)).toBe(true);
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it('a refusal keeps the app open and asks again next time', async () => {
    const mayExit = vi.fn(() => Promise.resolve(false));
    const t = build(mayExit);
    t.flow.beforeQuit(event());
    await vi.waitFor(() => {
      expect(mayExit).toHaveBeenCalledOnce();
    });
    expect(t.quit).not.toHaveBeenCalled();
    t.flow.windowClose(event());
    await vi.waitFor(() => {
      expect(mayExit).toHaveBeenCalledTimes(2);
    });
    expect(t.closeWindow).not.toHaveBeenCalled();
  });

  it('a window close asks the same gate, then closes the window itself without asking again', async () => {
    const mayExit = vi.fn(() => Promise.resolve(true));
    const t = build(mayExit);
    const first = event();
    t.flow.windowClose(first);
    expect(first.preventDefault).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(t.closeWindow).toHaveBeenCalledOnce();
    });
    const second = event();
    t.flow.windowClose(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(mayExit).toHaveBeenCalledOnce();
  });

  it('an exception in the gate is logged as close failed and the app stays open (97)', async () => {
    const t = build(() => Promise.reject(new Error('boom')));
    t.flow.windowClose(event());
    await vi.waitFor(() => {
      expect(t.log.error).toHaveBeenCalledWith('close failed', { error: 'boom' });
    });
    expect(t.closeWindow).not.toHaveBeenCalled();
    expect(t.flow.approved).toBe(false);
  });

  it('a restart that the gate approved quits without a second question (99)', () => {
    const mayExit = vi.fn(() => Promise.resolve(true));
    const t = build(mayExit);
    t.flow.approve();
    const e = event();
    expect(t.flow.beforeQuit(e)).toBe(true);
    expect(mayExit).not.toHaveBeenCalled();
  });
});
