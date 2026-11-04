import { describe, expect, it, vi } from 'vitest';
import { AppTray, type TrayLike } from './app-tray';
import { buildTrayModel } from './tray-model';

const strings: Record<string, string> = {
  'LiveCopilot_OpenApp.ToolTipService.ToolTip': 'Open Vozella',
  Ui_TrayQuit: 'Quit Vozella',
  Ui_TrayRecording: 'Vozella, recording',
};
const t = (key: string): string => strings[key] ?? key;

describe('buildTrayModel', () => {
  it('has Open Vozella and Quit, in that order, and the plain name as tooltip', () => {
    expect(buildTrayModel({ isRecording: false, t })).toEqual({
      tooltip: 'Vozella',
      items: [
        { id: 'open', label: 'Open Vozella' },
        { id: 'quit', label: 'Quit Vozella' },
      ],
    });
  });

  it('says so in the tooltip while recording', () => {
    expect(buildTrayModel({ isRecording: true, t }).tooltip).toBe('Vozella, recording');
  });
});

function setup() {
  const listeners = new Map<string, () => void>();
  let destroyed = false;
  const tray: TrayLike = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: (event, listener) => {
      listeners.set(event, listener);
    },
    destroy: vi.fn(() => {
      destroyed = true;
    }),
    isDestroyed: () => destroyed,
  };
  const open = vi.fn();
  const quit = vi.fn();
  let run: ((id: 'open' | 'quit') => void) | undefined;
  const buildMenu = vi.fn((_items: unknown, runner: (id: 'open' | 'quit') => void) => {
    run = runner;
    return { menu: true };
  });
  const appTray = new AppTray({ createTray: () => tray, buildMenu, t, open, quit });
  return {
    appTray,
    tray,
    listeners,
    open,
    quit,
    buildMenu,
    choose: (id: 'open' | 'quit') => run?.(id),
  };
}

describe('AppTray', () => {
  it('sets the tooltip and a menu at creation', () => {
    const { tray } = setup();
    expect(tray.setToolTip).toHaveBeenCalledWith('Vozella');
    expect(tray.setContextMenu).toHaveBeenCalledWith({ menu: true });
  });

  it('opens the window on click and on double click', () => {
    const { listeners, open } = setup();
    listeners.get('click')?.();
    listeners.get('double-click')?.();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('runs open and quit from the menu, and quit goes to the gated quit only', () => {
    const { choose, open, quit } = setup();
    choose('open');
    expect(open).toHaveBeenCalledTimes(1);
    expect(quit).not.toHaveBeenCalled();
    choose('quit');
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('updates the tooltip when recording changes, once per change', () => {
    const { appTray, tray } = setup();
    appTray.setRecording(true);
    appTray.setRecording(true);
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Vozella, recording');
    expect(tray.setToolTip).toHaveBeenCalledTimes(2);
    appTray.setRecording(false);
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Vozella');
  });

  it('destroys the tray once and ignores later updates', () => {
    const { appTray, tray } = setup();
    appTray.destroy();
    appTray.destroy();
    appTray.setRecording(true);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(tray.setToolTip).toHaveBeenCalledTimes(1);
  });
});
