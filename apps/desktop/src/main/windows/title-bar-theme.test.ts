import { describe, expect, it } from 'vitest';
import { titleBarOverlayFor, windowBackground } from './title-bar-theme';

describe('title bar theme', () => {
  it('matches the paper and ink tokens in light', () => {
    expect(titleBarOverlayFor('light')).toEqual({
      color: '#ffffff',
      symbolColor: '#0a0a0a',
      height: 40,
    });
    expect(windowBackground('light')).toBe('#ffffff');
  });

  it('inverts in dark so caption buttons stay legible', () => {
    expect(titleBarOverlayFor('dark')).toEqual({
      color: '#0a0a0a',
      symbolColor: '#ffffff',
      height: 40,
    });
    expect(windowBackground('dark')).toBe('#0a0a0a');
  });
});
