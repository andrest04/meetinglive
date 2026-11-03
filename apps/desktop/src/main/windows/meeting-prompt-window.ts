import path from 'node:path';
import { popupBounds, POPUP_HEIGHT_DIP, POPUP_WIDTH_DIP, type Rect } from '@vozella/core';
import { BrowserWindow, screen } from 'electron';
import { APP_ORIGIN } from '../security/trusted-origin';

/** Renderer entry of the popup (built by the popup UI package). */
export const MEETING_PROMPT_ENTRY_URL = `${APP_ORIGIN}/meeting-prompt.html`;

export interface PopupWindowLike {
  loadURL(url: string): Promise<void> | void;
  setBounds(bounds: Rect): void;
  showInactive(): void;
  hide(): void;
  isDestroyed(): boolean;
  isVisible(): boolean;
  close(): void;
  once(event: 'closed', listener: () => void): void;
  readonly webContents: { readonly id: number };
}

export interface PopupWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly show: false;
  readonly frame: false;
  readonly transparent: true;
  readonly resizable: false;
  readonly maximizable: false;
  readonly minimizable: false;
  readonly fullscreenable: false;
  readonly skipTaskbar: true;
  readonly focusable: false;
  readonly alwaysOnTop: true;
  readonly hasShadow: false;
  readonly backgroundColor: string;
  readonly webPreferences: Readonly<Record<string, unknown>>;
}

export interface DisplayInfo {
  readonly workArea: Rect;
}

export interface MeetingPromptWindowDeps {
  readonly createWindow: (options: PopupWindowOptions) => PopupWindowLike;
  /** Display holding the given bounds (Electron's screen.getDisplayMatching). */
  readonly getDisplayMatching: (bounds: Rect) => DisplayInfo;
  /** Bounds of the main window, or null when it does not exist. */
  readonly getMainWindowBounds: () => Rect | null;
  /** Fallback when there is no main window. */
  readonly getPrimaryDisplay: () => DisplayInfo;
  readonly entryUrl: string;
  readonly preloadPath: string;
}

export function popupWindowOptions(preloadPath: string): PopupWindowOptions {
  return {
    width: POPUP_WIDTH_DIP,
    height: POPUP_HEIGHT_DIP,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    // Same rules as the main window. harden.ts applies to every web contents globally.
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  };
}

export class MeetingPromptWindow {
  private window: PopupWindowLike | null = null;

  constructor(private readonly deps: MeetingPromptWindowDeps) {}

  /** Creates the window on first use, places it on the main window display and shows it without focus. */
  show(): PopupWindowLike {
    const win = this.ensure();
    win.setBounds(this.place());
    win.showInactive();
    return win;
  }

  hide(): void {
    this.current()?.hide();
  }

  current(): PopupWindowLike | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  dispose(): void {
    const win = this.current();
    this.window = null;
    win?.close();
  }

  private ensure(): PopupWindowLike {
    const existing = this.current();
    if (existing) return existing;
    const win = this.deps.createWindow(popupWindowOptions(this.deps.preloadPath));
    win.once('closed', () => {
      if (this.window === win) this.window = null;
    });
    void win.loadURL(this.deps.entryUrl);
    this.window = win;
    return win;
  }

  /** S7 fix: the display of the main window, not the one the popup last sat on. */
  private place(): Rect {
    const main = this.deps.getMainWindowBounds();
    const display = main ? this.deps.getDisplayMatching(main) : this.deps.getPrimaryDisplay();
    // Electron window bounds are already device independent, so the scale is 1 here.
    return popupBounds(display.workArea, 1);
  }
}

/** Production wiring against Electron. */
export function createMeetingPromptWindow(
  getMainWindow: () => BrowserWindow | null,
  entryUrl: string = MEETING_PROMPT_ENTRY_URL,
): MeetingPromptWindow {
  return new MeetingPromptWindow({
    createWindow: (options) => new BrowserWindow({ ...options }),
    getDisplayMatching: (bounds) => screen.getDisplayMatching(bounds),
    getMainWindowBounds: () => {
      const main = getMainWindow();
      return main && !main.isDestroyed() ? main.getBounds() : null;
    },
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    entryUrl,
    preloadPath: path.join(__dirname, '../preload/index.js'),
  });
}
