import path from 'node:path';
import { appFocusChanged } from '@vozella/contracts';
import { BrowserWindow } from 'electron';
import { sendEvent } from '../ipc/ipc-server';
import { APP_ENTRY_URL } from '../security/trusted-origin';

export interface MainWindowOptions {
  /** Vite dev server URL, only set when running `electron-vite dev`. */
  readonly devServerUrl: string | undefined;
  /** Hide the window (automated runs and smoke checks). */
  readonly showOnReady: boolean;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#ffffff',
    title: 'Vozella',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
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
  });

  window.once('ready-to-show', () => {
    if (options.showOnReady) window.show();
  });
  window.on('focus', () => {
    sendEvent(window.webContents, appFocusChanged, { focused: true });
  });
  window.on('blur', () => {
    sendEvent(window.webContents, appFocusChanged, { focused: false });
  });

  void window.loadURL(options.devServerUrl ?? APP_ENTRY_URL);
  return window;
}
