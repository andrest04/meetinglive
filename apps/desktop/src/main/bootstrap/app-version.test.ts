import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveAppVersion } from './app-version';

describe('resolveAppVersion', () => {
  it('reads the package file two levels above the main folder', () => {
    let asked = '';
    const version = resolveAppVersion(path.join('app', 'out', 'main'), '9.9.9', (file) => {
      asked = file;
      return '{"version":"1.0.0"}';
    });
    expect(version).toBe('1.0.0');
    expect(asked).toBe(path.join('app', 'package.json'));
  });

  it('uses the fallback when the file is missing, broken or has no usable version', () => {
    const fail = (): string => {
      throw new Error('ENOENT');
    };
    expect(resolveAppVersion('x/out/main', '1.0.0.0', fail)).toBe('1.0.0.0');
    expect(resolveAppVersion('x/out/main', '1.0.0.0', () => 'not json')).toBe('1.0.0.0');
    expect(resolveAppVersion('x/out/main', '1.0.0.0', () => '{"version":"abc"}')).toBe('1.0.0.0');
    expect(resolveAppVersion('x/out/main', '1.0.0.0', () => '{}')).toBe('1.0.0.0');
  });
});
