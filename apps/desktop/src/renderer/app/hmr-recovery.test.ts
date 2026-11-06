import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_RELOAD_KEY,
  claimAutoReload,
  createHmrRecovery,
  mayAutoReload,
  type ReloadStorage,
} from './hmr-recovery';

function memoryStorage(): ReloadStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('mayAutoReload', () => {
  it('allows the first reload', () => {
    expect(mayAutoReload(undefined, 10_000)).toBe(true);
  });

  it('refuses a second reload within five seconds', () => {
    expect(mayAutoReload(10_000, 14_999)).toBe(false);
  });

  it('allows a reload once five seconds have passed', () => {
    expect(mayAutoReload(10_000, 15_000)).toBe(true);
  });

  it('allows a reload when the stored time is in the future (clock change)', () => {
    expect(mayAutoReload(20_000, 10_000)).toBe(true);
  });
});

describe('claimAutoReload', () => {
  it('claims once and records the time', () => {
    const storage = memoryStorage();
    expect(claimAutoReload(storage, 1_000)).toBe(true);
    expect(storage.getItem(AUTO_RELOAD_KEY)).toBe('1000');
    expect(claimAutoReload(storage, 2_000)).toBe(false);
    expect(claimAutoReload(storage, 6_000)).toBe(true);
  });

  it('treats an unreadable stored value as no previous reload', () => {
    const storage = memoryStorage();
    storage.setItem(AUTO_RELOAD_KEY, 'garbage');
    expect(claimAutoReload(storage, 1_000)).toBe(true);
  });
});

describe('createHmrRecovery', () => {
  function setup(rootEmpty: boolean) {
    let now = 50_000;
    const reload = vi.fn();
    const recovery = createHmrRecovery({
      storage: memoryStorage(),
      now: () => now,
      reload,
      isRootEmpty: () => rootEmpty,
    });
    return {
      recovery,
      reload,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('reloads when the root is empty after an update', () => {
    const { recovery, reload } = setup(true);
    recovery.afterUpdate();
    recovery.checkRoot();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a rendered root alone', () => {
    const { recovery, reload } = setup(false);
    recovery.afterUpdate();
    recovery.checkRoot();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads on a render crash right after an update', () => {
    const { recovery, reload, advance } = setup(false);
    recovery.afterUpdate();
    advance(1_000);
    expect(recovery.renderCrashed()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on a crash long after the last update', () => {
    const { recovery, reload, advance } = setup(false);
    recovery.afterUpdate();
    advance(10_000);
    expect(recovery.renderCrashed()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload on a crash with no update at all', () => {
    const { recovery, reload } = setup(false);
    expect(recovery.renderCrashed()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('never reloads twice within the guard window', () => {
    const { recovery, reload, advance } = setup(true);
    recovery.afterUpdate();
    recovery.checkRoot();
    advance(1_000);
    recovery.afterUpdate();
    recovery.checkRoot();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
