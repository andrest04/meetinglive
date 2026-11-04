import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveWindowPlacement } from '@vozella/core';
import { mainWindowOptions } from './main-window-options';

const iconPath = path.resolve('build', 'icon.ico');
const base = {
  theme: 'light' as const,
  placement: resolveWindowPlacement(null, []),
  iconPath,
  preloadPath: path.resolve('out', 'preload', 'index.js'),
};

describe('mainWindowOptions', () => {
  it('opens at 1180 x 760 with a 960 x 680 minimum (items 16, 17)', () => {
    const options = mainWindowOptions(base);
    expect([options.width, options.height]).toEqual([1180, 760]);
    expect([options.minWidth, options.minHeight]).toEqual([960, 680]);
  });

  it('does no DPI math, so the minimum follows the monitor (bug 13)', () => {
    // A scaled minimum would differ from 960 x 680 on a 150 percent display. There is no scale
    // input at all: Electron applies the scale of whichever monitor the window is on.
    expect(mainWindowOptions({ ...base, theme: 'dark' }).minWidth).toBe(960);
    expect(mainWindowOptions({ ...base, theme: 'dark' }).minHeight).toBe(680);
  });

  it('is titled Vozella with the given absolute icon (item 13, bug 14)', () => {
    const options = mainWindowOptions(base);
    expect(options.title).toBe('Vozella');
    expect(options.icon).toBe(iconPath);
    expect(path.isAbsolute(iconPath)).toBe(true);
  });

  it('uses a solid background and no Mica (item 15)', () => {
    const options = mainWindowOptions(base);
    expect(options.backgroundColor).toBe('#ffffff');
    expect(options).not.toHaveProperty('backgroundMaterial');
    expect(mainWindowOptions({ ...base, theme: 'dark' }).backgroundColor).toBe('#0a0a0a');
  });

  it('leaves the position to the OS when none was saved', () => {
    const options = mainWindowOptions(base);
    expect(options).not.toHaveProperty('x');
    expect(options).not.toHaveProperty('y');
  });

  it('applies a saved placement', () => {
    const options = mainWindowOptions({
      ...base,
      placement: { bounds: { x: 40, y: 30, width: 1300, height: 800 }, maximized: false },
    });
    expect([options.x, options.y, options.width, options.height]).toEqual([40, 30, 1300, 800]);
  });

  it('keeps the renderer sandboxed', () => {
    const prefs = mainWindowOptions(base).webPreferences;
    expect(prefs).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
  });

  it('starts hidden so the first paint is not a white flash', () => {
    expect(mainWindowOptions(base).show).toBe(false);
  });
});
