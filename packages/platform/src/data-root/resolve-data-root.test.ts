import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertNotLegacyRoot,
  ForbiddenDataRootError,
  InvalidDataRootError,
  isUnderOrEqual,
  resolveDataRoots,
  type DataRootInput,
} from './resolve-data-root';

const base: DataRootInput = {
  env: {},
  mode: 'development',
  localAppData: 'C:\\Users\\ana\\AppData\\Local',
  documents: 'C:\\Users\\ana\\Documents',
  tempDir: 'C:\\Users\\ana\\AppData\\Local\\Temp',
  pathApi: path.win32,
};

const withEnv = (value: string, mode: DataRootInput['mode'] = 'test'): DataRootInput => ({
  ...base,
  mode,
  env: { VOZELLA_DATA_ROOT: value },
});

describe('isUnderOrEqual', () => {
  it('matches equal and nested paths, ignoring case on Windows', () => {
    expect(isUnderOrEqual('C:\\A\\B', 'c:\\a', path.win32)).toBe(true);
    expect(isUnderOrEqual('C:\\A', 'C:\\A', path.win32)).toBe(true);
  });

  it('does not match siblings that share a prefix', () => {
    expect(isUnderOrEqual('C:\\Docs\\MeetingLive2', 'C:\\Docs\\MeetingLive', path.win32)).toBe(
      false,
    );
  });
});

describe('resolveDataRoots', () => {
  it('honors VOZELLA_DATA_ROOT', () => {
    const roots = resolveDataRoots(withEnv('D:\\tmp\\run1'));
    expect(roots).toEqual({
      appData: 'D:\\tmp\\run1\\app',
      meetings: 'D:\\tmp\\run1\\meetings',
      source: 'env',
    });
  });

  it('uses the product folders when packaged and unset', () => {
    const roots = resolveDataRoots({ ...base, mode: 'production' });
    expect(roots).toEqual({
      appData: 'C:\\Users\\ana\\AppData\\Local\\Vozella',
      meetings: 'C:\\Users\\ana\\Documents\\Vozella',
      source: 'default',
    });
  });

  it('falls back to a throwaway temp folder in dev and test', () => {
    for (const mode of ['development', 'test'] as const) {
      const roots = resolveDataRoots({ ...base, mode });
      expect(roots.source).toBe('dev-fallback');
      expect(roots.appData).toBe('C:\\Users\\ana\\AppData\\Local\\Temp\\vozella-dev-data\\app');
    }
  });

  it('rejects a relative VOZELLA_DATA_ROOT', () => {
    expect(() => resolveDataRoots(withEnv('relative\\dir'))).toThrow(InvalidDataRootError);
  });

  it.each([
    ['the real meetings folder', 'C:\\Users\\ana\\Documents\\MeetingLive'],
    ['a folder inside it', 'C:\\Users\\ana\\Documents\\MeetingLive\\sandbox'],
    ['the real app data folder', 'C:\\Users\\ana\\AppData\\Local\\MeetingLive'],
    ['a different case', 'c:\\users\\ANA\\documents\\meetinglive'],
    ['a relocated folder with the legacy name', 'E:\\OneDrive\\Documents\\MeetingLive\\x'],
    ['a parent-relative escape', 'C:\\Users\\ana\\Documents\\tmp\\..\\MeetingLive'],
  ])('refuses %s in dev, test and production', (_label, value) => {
    for (const mode of ['development', 'test', 'production'] as const) {
      expect(() => resolveDataRoots(withEnv(value, mode))).toThrow(ForbiddenDataRootError);
    }
  });

  it('refuses a path that resolves into the real folder through a link', () => {
    const input: DataRootInput = {
      ...withEnv('D:\\tmp\\link'),
      realpath: (p) =>
        p.startsWith('D:\\tmp\\link') ? 'C:\\Users\\ana\\Documents\\MeetingLive' : p,
    };
    expect(() => resolveDataRoots(input)).toThrow(ForbiddenDataRootError);
  });

  it('allows a folder whose name only starts with the legacy name', () => {
    expect(() => resolveDataRoots(withEnv('D:\\tmp\\MeetingLive-copy'))).not.toThrow();
  });
});

describe('assertNotLegacyRoot', () => {
  it('can be reused for other candidates', () => {
    expect(() => assertNotLegacyRoot('C:\\Users\\ana\\Documents\\MeetingLive', base)).toThrow(
      ForbiddenDataRootError,
    );
    expect(() => assertNotLegacyRoot('C:\\Users\\ana\\Documents\\Vozella', base)).not.toThrow();
  });
});
