import type { Logger } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { CloseGuard, RendererCloseDialogs, type CloseDialogs } from './close-guard';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function build(state: { recording?: boolean; pending?: boolean; saved?: boolean | Error } = {}) {
  const calls: string[] = [];
  const answers = { confirm: true, closeAnyway: false };
  const dialogs: CloseDialogs = {
    confirmStop: () => {
      calls.push('confirm');
      return Promise.resolve(answers.confirm);
    },
    showSaving: () => calls.push('saving'),
    hideSaving: () => calls.push('hide'),
    saveFailed: () => {
      calls.push('failed');
      return Promise.resolve(answers.closeAnyway);
    },
  };
  const service = {
    requiresCloseConfirmation: state.recording ?? false,
    hasPendingSaves: state.pending ?? false,
    shutdown: vi.fn(() => {
      calls.push('shutdown');
      const saved = state.saved ?? true;
      return saved instanceof Error ? Promise.reject(saved) : Promise.resolve(saved);
    }),
  };
  const guard = new CloseGuard({
    service,
    dialogs,
    restoreWindow: () => calls.push('restore'),
    logger,
  });
  return { guard, calls, answers, service };
}

describe('CloseGuard (165)', () => {
  it('lets an idle app close without a dialog', async () => {
    const t = build();
    expect(await t.guard.mayClose()).toBe(true);
    expect(t.calls).toEqual([]);
  });

  it('restores the window, confirms, shows the progress and closes when saved', async () => {
    const t = build({ recording: true });
    expect(await t.guard.mayClose()).toBe(true);
    expect(t.calls).toEqual(['restore', 'confirm', 'saving', 'shutdown', 'hide']);
  });

  it('keeps recording when the user declines, and saves nothing', async () => {
    const t = build({ recording: true });
    t.answers.confirm = false;
    expect(await t.guard.mayClose()).toBe(false);
    expect(t.service.shutdown).not.toHaveBeenCalled();
  });

  it('pending saves without a recording skip the confirmation but still show progress', async () => {
    const t = build({ pending: true });
    expect(await t.guard.mayClose()).toBe(true);
    expect(t.calls).toEqual(['restore', 'saving', 'shutdown', 'hide']);
  });

  it('a take that did not save asks Close anyway, and Keep open stays', async () => {
    const t = build({ recording: true, saved: false });
    expect(await t.guard.mayClose()).toBe(false);
    expect(t.calls.at(-1)).toBe('failed');
    t.answers.closeAnyway = true;
    expect(await t.guard.mayClose()).toBe(true);
  });

  it('refuses a second request while one is deciding', async () => {
    const t = build({ recording: true });
    const first = t.guard.mayClose();
    expect(await t.guard.mayClose()).toBe(false);
    expect(await first).toBe(true);
  });

  it('any exception means stay open, and the progress is hidden', async () => {
    const t = build({ recording: true, saved: new Error('boom') });
    expect(await t.guard.mayClose()).toBe(false);
    expect(t.calls).toContain('hide');
    // The guard is usable again afterwards.
    expect(await t.guard.mayClose()).toBe(false);
  });
});

describe('RendererCloseDialogs', () => {
  it('sends a request and resolves with the shell answer, once', async () => {
    const sent: { requestId: string; dialog: string }[] = [];
    let n = 0;
    const dialogs = new RendererCloseDialogs({
      send: (r) => sent.push(r),
      windowAvailable: () => true,
      newId: () => `r${++n}`,
    });
    const answer = dialogs.confirmStop();
    expect(sent).toEqual([{ requestId: 'r1', dialog: 'confirm-stop' }]);
    expect(dialogs.answer('r1', true)).toBe(true);
    expect(await answer).toBe(true);
    expect(dialogs.answer('r1', false)).toBe(false);
    dialogs.showSaving();
    dialogs.hideSaving();
    expect(sent.slice(1)).toEqual([
      { requestId: 'r2', dialog: 'saving' },
      { requestId: 'r2', dialog: 'done' },
    ]);
  });

  it('rejects when no window can show the dialog', async () => {
    const dialogs = new RendererCloseDialogs({
      send: vi.fn(),
      windowAvailable: () => false,
      newId: () => 'x',
    });
    await expect(dialogs.saveFailed()).rejects.toThrow();
  });
});
