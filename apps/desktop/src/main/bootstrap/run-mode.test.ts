import { describe, expect, it } from 'vitest';
import { isFakeNative, resolveRunMode } from './run-mode';

describe('resolveRunMode', () => {
  it('is production when packaged, whatever the environment says', () => {
    expect(resolveRunMode(true, { VOZELLA_E2E: '1', NODE_ENV: 'test' })).toBe('production');
  });

  it('is test for automated runs and development otherwise', () => {
    expect(resolveRunMode(false, { VOZELLA_E2E: '1' })).toBe('test');
    expect(resolveRunMode(false, { NODE_ENV: 'test' })).toBe('test');
    expect(resolveRunMode(false, {})).toBe('development');
  });
});

describe('isFakeNative', () => {
  it('only accepts 1', () => {
    expect(isFakeNative({ VOZELLA_FAKE_NATIVE: '1' })).toBe(true);
    expect(isFakeNative({ VOZELLA_FAKE_NATIVE: 'true' })).toBe(false);
    expect(isFakeNative({})).toBe(false);
  });
});
