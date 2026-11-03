import { describe, expect, it } from 'vitest';
import { shouldShowPopup } from './popup-policy';

describe('shouldShowPopup', () => {
  it('shows when enabled, idle and not prompted', () => {
    expect(shouldShowPopup(true, false, false)).toBe(true);
  });
  it('hides when the setting is off', () => {
    expect(shouldShowPopup(false, false, false)).toBe(false);
  });
  it('hides while recording', () => {
    expect(shouldShowPopup(true, true, false)).toBe(false);
  });
  it('hides when already prompted', () => {
    expect(shouldShowPopup(true, false, true)).toBe(false);
  });
});
