import path from 'node:path';
import type { EventChannel, PayloadInputOf } from '@vozella/contracts';
import type { Rect } from '@vozella/core';
import { BrowserWindow } from 'electron';
import { sendEvent } from '../ipc/ipc-server';
import { GUTTER_DIP } from '../live-copilot/pill-controller';
import { APP_ORIGIN } from '../security/trusted-origin';

/** Renderer entry of the pill (built by the capsule UI package). */
export const PILL_ENTRY_URL = `${APP_ORIGIN}/pill.html`;

/** What a user drag looks like to the controller. */
export interface PillMoveEvent {
  /** Where the OS wants the window, in DIP. */
  readonly newBounds: Rect;
  /** Windows only: stops this move. */
  preventDefault(): void;
}

/** The slice of a BrowserWindow the pill controller needs. Tests use a fake. */
export interface PillWindowPort {
  readonly webContentsId: number;
  setBounds(bounds: Rect): void;
  getBounds(): Rect;
  showInactive(): void;
  hide(): void;
  isVisible(): boolean;
  isDestroyed(): boolean;
  close(): void;
  /** Resolves when the page has loaded. */
  whenLoaded(): Promise<void>;
  send<C extends EventChannel>(channel: C, payload: PayloadInputOf<C>): void;
  /** The user started or continued dragging (the OS move loop). */
  onWillMove(listener: (event: PillMoveEvent) => void): void;
  /** The move loop ended. */
  onMoved(listener: () => void): void;
  onClosed(listener: () => void): void;
}

export interface PillWindowOptions {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly show: false;
  readonly frame: false;
  readonly transparent: true;
  readonly backgroundColor: string;
  readonly hasShadow: false;
  readonly thickFrame: false;
  readonly resizable: false;
  readonly maximizable: false;
  readonly minimizable: false;
  readonly fullscreenable: false;
  readonly skipTaskbar: true;
  readonly alwaysOnTop: true;
  readonly focusable: true;
  readonly webPreferences: Readonly<Record<string, unknown>>;
}

/**
 * The options the window spike proved at 125% scale (docs/port/specs/live-copilot.md section 2.2):
 * frameless and transparent replaces the WinUI frame stripping, the GDI region and the DWM
 * attributes. `focusable` stays true so a click activates the pill and the ask box can type;
 * `showInactive()` is what keeps focus where it was when the pill appears.
 */
export function pillWindowOptions(preloadPath: string, title: string): PillWindowOptions {
  return {
    width: 64 + 2 * GUTTER_DIP,
    height: 240 + 2 * GUTTER_DIP,
    title,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    thickFrame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
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

/** Production wiring against Electron. */
export function createPillBrowserWindow(
  options: PillWindowOptions,
  entryUrl: string = PILL_ENTRY_URL,
): PillWindowPort {
  const win = new BrowserWindow({ ...options });
  // The spike's level: above normal windows, below the system's own overlays.
  win.setAlwaysOnTop(true, 'floating');
  // The page's own <title> must not replace the localized window title.
  win.on('page-title-updated', (event) => {
    event.preventDefault();
  });
  const loaded = new Promise<void>((resolve) => {
    win.webContents.once('did-finish-load', () => {
      resolve();
    });
    // A failed load never resolves `loaded`; the window is shown anyway after the close.
    win.once('closed', () => {
      resolve();
    });
  });
  void win.loadURL(entryUrl);
  const id = win.webContents.id;
  return {
    webContentsId: id,
    setBounds: (bounds) => {
      win.setBounds(bounds);
    },
    getBounds: () => win.getBounds(),
    showInactive: () => {
      win.showInactive();
    },
    hide: () => {
      win.hide();
    },
    isVisible: () => win.isVisible(),
    isDestroyed: () => win.isDestroyed(),
    close: () => {
      win.close();
    },
    whenLoaded: () => loaded,
    send: (channel, payload) => {
      sendEvent(win.webContents, channel, payload);
    },
    onWillMove: (listener) => {
      win.on('will-move', (event, newBounds) => {
        listener({ newBounds, preventDefault: () => event.preventDefault() });
      });
    },
    onMoved: (listener) => {
      win.on('moved', listener);
    },
    onClosed: (listener) => {
      win.once('closed', listener);
    },
  };
}

export function pillPreloadPath(): string {
  return path.join(__dirname, '../preload/index.js');
}
