import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl } from './external-url';

describe('isSafeExternalUrl', () => {
  it.each(['https://claude.com/claude-code', 'https://github.com/openai/codex'])(
    'allows %s',
    (u) => {
      expect(isSafeExternalUrl(u)).toBe(true);
    },
  );

  it.each([
    'http://claude.com',
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'ms-settings:privacy',
    'https://user:pw@claude.com',
    'https://',
    'not a url',
    '',
  ])('refuses %s', (u) => {
    expect(isSafeExternalUrl(u)).toBe(false);
  });
});
