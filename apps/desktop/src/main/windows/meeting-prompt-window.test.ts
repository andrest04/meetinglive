import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: vi.fn(), screen: {} }));

import {
  MeetingPromptWindow,
  popupWindowOptions,
  type PopupWindowLike,
  type PopupWindowOptions,
} from './meeting-prompt-window';

function fakeWindow() {
  let closed: (() => void) | undefined;
  let destroyed = false;
  const win = {
    loadURL: vi.fn(),
    setBounds: vi.fn(),
    showInactive: vi.fn(),
    hide: vi.fn(),
    isDestroyed: () => destroyed,
    isVisible: () => true,
    close: vi.fn(() => {
      destroyed = true;
      closed?.();
    }),
    once: (_event: 'closed', listener: () => void) => {
      closed = listener;
    },
    webContents: { id: 7 },
  } satisfies PopupWindowLike;
  const fireClosed = (): void => {
    destroyed = true;
    closed?.();
  };
  return { win, fireClosed };
}

function setup(mainBounds: { x: number; y: number; width: number; height: number } | null) {
  const created: ReturnType<typeof fakeWindow>[] = [];
  const optionsSeen: PopupWindowOptions[] = [];
  const getDisplayMatching = vi.fn(() => ({
    workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
  }));
  const controller = new MeetingPromptWindow({
    createWindow: (options) => {
      optionsSeen.push(options);
      const fake = fakeWindow();
      created.push(fake);
      return fake.win;
    },
    getDisplayMatching,
    getMainWindowBounds: () => mainBounds,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 600 } }),
    entryUrl: 'vozella://app/meeting-prompt.html',
    preloadPath: 'preload.js',
  });
  return { controller, created, optionsSeen, getDisplayMatching };
}

describe('MeetingPromptWindow', () => {
  it('creates nothing until the first show', () => {
    const { created } = setup(null);
    expect(created).toHaveLength(0);
  });

  it('uses always-on-top, frameless, non-focusable options and the main window security rules', () => {
    const options = popupWindowOptions('p.js');
    expect(options).toMatchObject({
      width: 480,
      height: 72,
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
    });
    expect(options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
    });
  });

  it('shows inactive, loads the entry once and reuses the window (W10)', () => {
    const { controller, created } = setup(null);
    controller.show();
    controller.show();
    expect(created).toHaveLength(1);
    expect(created[0]!.win.loadURL).toHaveBeenCalledTimes(1);
    expect(created[0]!.win.loadURL).toHaveBeenCalledWith('vozella://app/meeting-prompt.html');
    expect(created[0]!.win.showInactive).toHaveBeenCalledTimes(2);
  });

  it('places on the display of the main window (S7)', () => {
    const main = { x: 2000, y: 100, width: 800, height: 600 };
    const { controller, created, getDisplayMatching } = setup(main);
    controller.show();
    expect(getDisplayMatching).toHaveBeenCalledWith(main);
    expect(created[0]!.win.setBounds).toHaveBeenCalledWith({
      x: 1920 + 1920 - 480 - 24,
      y: 24,
      width: 480,
      height: 72,
    });
  });

  it('falls back to the primary display without a main window', () => {
    const { controller, created, getDisplayMatching } = setup(null);
    controller.show();
    expect(getDisplayMatching).not.toHaveBeenCalled();
    expect(created[0]!.win.setBounds).toHaveBeenCalledWith({
      x: 496,
      y: 24,
      width: 480,
      height: 72,
    });
  });

  it('forgets the window when it closes and recreates it on the next show', () => {
    const { controller, created } = setup(null);
    controller.show();
    created[0]!.fireClosed();
    expect(controller.current()).toBeNull();
    controller.show();
    expect(created).toHaveLength(2);
  });
});
