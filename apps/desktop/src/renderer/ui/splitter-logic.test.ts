import { describe, expect, it } from 'vitest';
import { sizeForDrag, sizeForKey } from './splitter-logic';

// The start-pane cases live in logic.test.ts; these cover a fixed pane at the end (right or bottom),
// where moving the handle toward the start makes that pane bigger.
describe('splitter logic with the fixed pane at the end', () => {
  const end = { min: 320, max: 520, orientation: 'horizontal' as const, fixedPane: 'end' as const };

  it('grows with ArrowLeft and shrinks with ArrowRight', () => {
    expect(sizeForKey('ArrowLeft', false, 380, end)).toBe(396);
    expect(sizeForKey('ArrowRight', false, 380, end)).toBe(364);
    expect(sizeForKey('ArrowLeft', true, 380, end)).toBe(444);
    expect(sizeForKey('ArrowRight', true, 380, end)).toBe(320);
  });

  it('grows with ArrowUp when stacked', () => {
    const vertical = { ...end, orientation: 'vertical' as const };
    expect(sizeForKey('ArrowUp', false, 380, vertical)).toBe(396);
    expect(sizeForKey('ArrowDown', false, 380, vertical)).toBe(364);
  });

  it('keeps Home and End on the limits of the pane', () => {
    expect(sizeForKey('Home', false, 400, end)).toBe(320);
    expect(sizeForKey('End', false, 400, end)).toBe(520);
  });

  it('grows while the pointer moves toward the start', () => {
    const limits = { min: 320, max: 520, fixedPane: 'end' as const };
    expect(sizeForDrag(380, 900, 850, limits)).toBe(430);
    expect(sizeForDrag(380, 900, 960, limits)).toBe(320);
    expect(sizeForDrag(380, 900, 100, limits)).toBe(520);
  });

  it('leaves the start pane behavior unchanged by default', () => {
    const start = { min: 100, max: 300, orientation: 'horizontal' as const };
    expect(sizeForKey('ArrowRight', false, 200, start)).toBe(216);
    expect(sizeForDrag(200, 400, 450, { min: 100, max: 300 })).toBe(250);
  });
});
