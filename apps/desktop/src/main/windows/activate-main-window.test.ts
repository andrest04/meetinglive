import { describe, expect, it } from 'vitest';
import { activateMainWindow, type ActivatableWindow } from './activate-main-window';

function fake(state: { destroyed?: boolean; visible?: boolean; minimized?: boolean }) {
  const calls: string[] = [];
  const window: ActivatableWindow = {
    isDestroyed: () => state.destroyed ?? false,
    isVisible: () => state.visible ?? true,
    isMinimized: () => state.minimized ?? false,
    show: () => calls.push('show'),
    restore: () => calls.push('restore'),
    focus: () => calls.push('focus'),
  };
  return { window, calls };
}

describe('activateMainWindow', () => {
  it('only focuses a visible window', () => {
    const { window, calls } = fake({});
    expect(activateMainWindow(window)).toBe(true);
    expect(calls).toEqual(['focus']);
  });

  it('restores a minimized window before focusing it (bug 9)', () => {
    const { window, calls } = fake({ minimized: true });
    activateMainWindow(window);
    expect(calls).toEqual(['restore', 'focus']);
  });

  it('shows a hidden window', () => {
    const { window, calls } = fake({ visible: false });
    activateMainWindow(window);
    expect(calls).toEqual(['show', 'focus']);
  });

  it('restores, shows and focuses a window that is minimized and hidden', () => {
    const { window, calls } = fake({ minimized: true, visible: false });
    activateMainWindow(window);
    expect(calls).toEqual(['restore', 'show', 'focus']);
  });

  it('does nothing for a destroyed or missing window', () => {
    const { window, calls } = fake({ destroyed: true });
    expect(activateMainWindow(window)).toBe(false);
    expect(activateMainWindow(undefined)).toBe(false);
    expect(activateMainWindow(null)).toBe(false);
    expect(calls).toEqual([]);
  });
});
