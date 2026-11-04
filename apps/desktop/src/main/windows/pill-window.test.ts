import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }));

import { GUTTER_DIP } from '../live-copilot/pill-controller';
import { pillWindowOptions } from './pill-window';

describe('pillWindowOptions', () => {
  const options = pillWindowOptions('preload.js', 'Live copilot');

  it('is frameless and transparent, with no native frame, shadow or caption', () => {
    expect(options).toMatchObject({
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      thickFrame: false,
      show: false,
    });
  });

  it('is fixed, and not in the taskbar', () => {
    expect(options).toMatchObject({
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
    });
  });

  it('can take focus on a click, so the ask box types (the pill shows with showInactive)', () => {
    expect(options.focusable).toBe(true);
  });

  it('carries the localized title and the same page rules as every window', () => {
    expect(options.title).toBe('Live copilot');
    expect(options.webPreferences).toMatchObject({
      preload: 'preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });

  it('starts at the vertical capsule size plus the gutter on each side', () => {
    expect(options.width).toBe(64 + 2 * GUTTER_DIP);
    expect(options.height).toBe(240 + 2 * GUTTER_DIP);
  });
});
