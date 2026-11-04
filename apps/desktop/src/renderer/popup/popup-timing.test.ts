import { readFileSync } from 'node:fs';
import path from 'node:path';
import { POPUP_ENTRANCE_MS, POPUP_EXIT_MS, POPUP_SLIDE_DIP } from '@vozella/core';
import { describe, expect, it } from 'vitest';

// Items 55 and 56: the CSS is the copy that renders, so it must match the core constants that the
// main process uses for its exit timer.
const css = readFileSync(path.join(__dirname, 'popup.css'), 'utf8');

describe('popup animation timing', () => {
  it('the entrance is the core duration, eased out', () => {
    expect(css).toContain(`popup-in ${POPUP_ENTRANCE_MS}ms cubic-bezier(0.215,`);
  });

  it('the exit is the core duration the main timer waits for, eased in', () => {
    expect(css).toContain(`popup-out ${POPUP_EXIT_MS}ms cubic-bezier(0.55,`);
  });

  it('the entrance slides in from the core distance', () => {
    expect(css).toContain(`translateX(${POPUP_SLIDE_DIP}px)`);
  });
});
