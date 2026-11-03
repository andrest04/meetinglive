import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveNativeAddonPath } from './native-addon-path';

const base = {
  resourcesPath: path.resolve('/app/resources'),
  mainDir: path.resolve('/repo/apps/desktop/out/main'),
  platform: 'win32',
  arch: 'x64',
};

describe('resolveNativeAddonPath', () => {
  it('uses the unpacked folder when packaged', () => {
    expect(resolveNativeAddonPath({ ...base, isPackaged: true })).toBe(
      path.join(
        base.resourcesPath,
        'app.asar.unpacked',
        'out',
        'native',
        'vozella-native.win32-x64-msvc.node',
      ),
    );
  });

  it('uses the workspace build output otherwise', () => {
    expect(resolveNativeAddonPath({ ...base, isPackaged: false })).toBe(
      path.resolve('/repo/native/vozella-native/vozella-native.win32-x64-msvc.node'),
    );
  });

  it('fails clearly for a platform without a build', () => {
    expect(() => resolveNativeAddonPath({ ...base, isPackaged: true, platform: 'linux' })).toThrow(
      /linux-x64/,
    );
  });
});
