import type { AppSettings, SettingsStore } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { PillDockStore } from './pill-dock-store';

type Stored = Pick<AppSettings, 'liveCopilotPillEdge' | 'liveCopilotPillAlong'>;

function setup(stored: Stored, failLoad = false) {
  const settings = {
    load: vi.fn((): Promise<AppSettings> =>
      failLoad ? Promise.reject(new Error('locked')) : Promise.resolve(stored as AppSettings),
    ),
    update: vi.fn((patch: Partial<AppSettings>): Promise<AppSettings> => {
      expect(patch).toBeDefined();
      return Promise.resolve(stored as AppSettings);
    }),
  } satisfies SettingsStore;
  const warn = vi.fn();
  return { store: new PillDockStore(settings, { warn }), settings, warn };
}

describe('PillDockStore', () => {
  it('reads the edge and along from the settings, clamped and parsed', async () => {
    const { store } = setup({ liveCopilotPillEdge: 'left', liveCopilotPillAlong: 7 });
    expect(await store.load()).toEqual({ edge: 'Left', along: 1 });
  });

  it('defaults to the right edge, centered, when nothing is stored', async () => {
    const { store } = setup({ liveCopilotPillEdge: null, liveCopilotPillAlong: null });
    expect(await store.load()).toEqual({ edge: 'Right', along: 0.5 });
  });

  it('lets a read failure through, so the controller retries at the next show (bug 13)', async () => {
    const { store } = setup({ liveCopilotPillEdge: null, liveCopilotPillAlong: null }, true);
    await expect(store.load()).rejects.toThrow('locked');
  });

  it('bug 12: saves only the two dock fields through the serialized update', async () => {
    const { store, settings } = setup({ liveCopilotPillEdge: 'Right', liveCopilotPillAlong: 0.5 });
    await store.save({ edge: 'Top', along: 0.25 });
    expect(settings.update).toHaveBeenCalledWith({
      liveCopilotPillEdge: 'Top',
      liveCopilotPillAlong: 0.25,
    });
  });

  it('skips the write when the edge is equal and along is within 0.0005', async () => {
    const { store, settings } = setup({ liveCopilotPillEdge: 'Top', liveCopilotPillAlong: 0.25 });
    await store.save({ edge: 'Top', along: 0.2504 });
    expect(settings.update).not.toHaveBeenCalled();
    await store.save({ edge: 'Top', along: 0.2506 });
    expect(settings.update).toHaveBeenCalledTimes(1);
  });

  it('swallows and logs errors, from the read and from the write', async () => {
    const failing = setup({ liveCopilotPillEdge: null, liveCopilotPillAlong: null }, true);
    await expect(failing.store.save({ edge: 'Left', along: 0 })).resolves.toBeUndefined();
    expect(failing.warn).toHaveBeenCalled();

    const writing = setup({ liveCopilotPillEdge: null, liveCopilotPillAlong: null });
    writing.settings.update.mockRejectedValue(new Error('disk full'));
    await expect(writing.store.save({ edge: 'Left', along: 0 })).resolves.toBeUndefined();
    expect(writing.warn).toHaveBeenCalled();
  });
});
