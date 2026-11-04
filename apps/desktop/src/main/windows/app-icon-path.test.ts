import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveIconPath } from './app-icon-path';

describe('resolveIconPath', () => {
  it('reads resources/icons when packaged', () => {
    const resources = path.resolve('C:/Apps/Vozella/resources');
    expect(
      resolveIconPath({ isPackaged: true, resourcesPath: resources, appPath: 'x' }, 'icon.ico'),
    ).toBe(path.join(resources, 'icons', 'icon.ico'));
  });

  it('reads build/ under the app folder in development', () => {
    const app = path.resolve('C:/Code/vozella/apps/desktop');
    expect(
      resolveIconPath({ isPackaged: false, resourcesPath: 'x', appPath: app }, 'tray.ico'),
    ).toBe(path.join(app, 'build', 'tray.ico'));
  });

  it('is absolute even from relative inputs, so the working directory never matters (bug 14)', () => {
    const resolved = resolveIconPath(
      { isPackaged: false, resourcesPath: 'resources', appPath: '.' },
      'icon.ico',
    );
    expect(path.isAbsolute(resolved)).toBe(true);
  });
});
