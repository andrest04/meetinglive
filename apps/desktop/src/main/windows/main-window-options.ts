import type { BrowserWindowConstructorOptions } from 'electron';
import { DEFAULT_WINDOW_SIZE, MIN_WINDOW_SIZE, type WindowPlacement } from '@vozella/core';
import { titleBarOverlayFor, windowBackground, type ResolvedTheme } from './title-bar-theme';

export interface MainWindowOptionsInput {
  readonly theme: ResolvedTheme;
  /** Where the window opens; the defaults when nothing was saved. */
  readonly placement: WindowPlacement;
  /** Absolute path of the window icon (bug 14). */
  readonly iconPath: string;
  readonly preloadPath: string;
}

/**
 * The constructor options of the main window. Sizes are Electron device independent pixels, so
 * the minimum scales with the monitor the window is on, not the one it was created on (bug 13,
 * items 16 and 17). The background is solid by design (stack.md, item 15): no Mica.
 */
export function mainWindowOptions(input: MainWindowOptionsInput): BrowserWindowConstructorOptions {
  const { bounds } = input.placement;
  return {
    width: bounds.width || DEFAULT_WINDOW_SIZE.width,
    height: bounds.height || DEFAULT_WINDOW_SIZE.height,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: MIN_WINDOW_SIZE.width,
    minHeight: MIN_WINDOW_SIZE.height,
    show: false,
    icon: input.iconPath,
    backgroundColor: windowBackground(input.theme),
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlayFor(input.theme),
    title: 'Vozella',
    webPreferences: {
      preload: input.preloadPath,
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
