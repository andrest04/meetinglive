import { describe, expect, it } from 'vitest';
import {
  easeInCubic,
  easeInOutCubic,
  easeOutCubic,
  easeOutQuint,
  lerpRect,
  planSnap,
  shouldRedock,
  snapFrame,
  tweenProgress,
} from './pill-motion';

describe('easing', () => {
  it.each([easeOutQuint, easeInCubic, easeOutCubic, easeInOutCubic])('hits 0 and 1', (ease) => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('matches the formulas', () => {
    expect(easeOutQuint(0.5)).toBeCloseTo(1 - 0.5 ** 5, 12);
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 12);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12);
    expect(easeInOutCubic(0.25)).toBeCloseTo(4 * 0.25 ** 3, 12);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOutCubic(0.75)).toBeCloseTo(1 - (-2 * 0.75 + 2) ** 3 / 2, 12);
  });
});

describe('tweenProgress', () => {
  it('clamps elapsed over duration', () => {
    expect(tweenProgress(-5, 240)).toBe(0);
    expect(tweenProgress(120, 240)).toBe(0.5);
    expect(tweenProgress(999, 240)).toBe(1);
    expect(tweenProgress(10, 0)).toBe(1);
  });
});

describe('lerpRect', () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };
  const b = { x: 10, y: -10, width: 200, height: 51 };

  it('interpolates each component and hits the ends', () => {
    expect(lerpRect(a, b, 0)).toEqual(a);
    expect(lerpRect(a, b, 1)).toEqual(b);
    expect(lerpRect(a, b, 0.5)).toEqual({ x: 5, y: -5, width: 150, height: 50 });
  });

  it('rounds each component half to even', () => {
    const from = { x: 0, y: 0, width: 0, height: 0 };
    const to = { x: 3, y: 1, width: 5, height: 7 };
    // 1.5 -> 2, 0.5 -> 0, 2.5 -> 2, 3.5 -> 4
    expect(lerpRect(from, to, 0.5)).toEqual({ x: 2, y: 0, width: 2, height: 4 });
  });
});

describe('planSnap', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  it('without a flip, stays vertical and keeps the size', () => {
    const plan = planSnap({
      fromEdge: 'Right',
      window: { x: 100, y: 300, width: 64, height: 240 },
      area,
      scale: 1,
    });
    expect(plan.edge).toBe('Left');
    expect(plan.flip).toBe(false);
    expect(plan.target).toEqual({ x: 16, y: 300, width: 64, height: 240 });
    expect(plan.along).toBeCloseTo((300 - 16) / 768, 10);
  });

  it('with a flip, uses the new orientation size around the same center', () => {
    const plan = planSnap({
      fromEdge: 'Right',
      window: { x: 900, y: 10, width: 64, height: 240 },
      area,
      scale: 1,
    });
    // center (932, 130): top is nearest
    expect(plan.edge).toBe('Top');
    expect(plan.flip).toBe(true);
    expect(plan.target.width).toBe(272);
    expect(plan.target.height).toBe(64);
    expect(plan.target.y).toBe(16);
    expect(plan.target.x).toBe(932 - 136);
  });

  it('uses integer division for the center and rounds sizes at fractional DPI', () => {
    const plan = planSnap({
      fromEdge: 'Left',
      window: { x: 1000, y: 500, width: 81, height: 301 },
      area: { x: 0, y: 0, width: 2400, height: 1300 },
      scale: 1.25,
    });
    // center = (1000 + trunc(40.5), 500 + trunc(150.5)) = (1040, 650); bottom (650) beats top (650) on the tie.
    expect(plan.edge).toBe('Bottom');
    expect(plan.flip).toBe(true);
    expect(plan.target.width).toBe(340);
    expect(plan.target.height).toBe(80);
    expect(plan.target.y).toBe(1300 - 80 - 20);
  });

  it('honors strict tie order from the center', () => {
    const plan = planSnap({
      fromEdge: 'Left',
      window: { x: 468, y: 380, width: 64, height: 240 },
      area: { x: 0, y: 0, width: 1000, height: 1000 },
      scale: 1,
    });
    expect(plan.edge).toBe('Right');
    expect(plan.flip).toBe(false);
  });
});

describe('snapFrame', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const noFlip = planSnap({
    fromEdge: 'Right',
    window: { x: 100, y: 300, width: 64, height: 240 },
    area,
    scale: 1,
  });
  const flip = planSnap({
    fromEdge: 'Right',
    window: { x: 900, y: 10, width: 64, height: 240 },
    area,
    scale: 1,
  });

  it('without a flip eases out and keeps opacity at 1', () => {
    const from = { x: 100, y: 300, width: 64, height: 240 };
    const f = snapFrame(noFlip, from, 120, 240);
    // 100 + (16 - 100) * 0.875 = 26.5, half to even is 26
    expect(f.rect.x).toBe(26);
    expect(f.opacity).toBe(1);
    expect(f.switchOrientation).toBe(false);
    expect(snapFrame(noFlip, from, 240, 240).rect).toEqual(noFlip.target);
  });

  it('with a flip switches orientation at eased >= 0.5 and crossfades', () => {
    const from = { x: 900, y: 10, width: 64, height: 240 };
    const early = snapFrame(flip, from, 40, 240);
    expect(early.switchOrientation).toBe(false);
    expect(early.opacity).toBeCloseTo(Math.abs(2 * early.eased - 1), 12);
    const mid = snapFrame(flip, from, 120, 240);
    expect(mid.switchOrientation).toBe(true);
    expect(mid.opacity).toBeCloseTo(0, 12);
    const end = snapFrame(flip, from, 240, 240);
    expect(end.opacity).toBe(1);
    expect(end.rect).toEqual(flip.target);
  });
});

describe('shouldRedock', () => {
  const expected = { x: 10, y: 20, width: 64, height: 240 };

  it('ignores differences within 2 px on every component', () => {
    expect(shouldRedock(expected, { ...expected }, 2)).toBe(false);
    expect(shouldRedock(expected, { x: 12, y: 18, width: 66, height: 238 }, 2)).toBe(false);
  });

  it('redocks when any component differs by more than 2 px', () => {
    expect(shouldRedock(expected, { ...expected, x: 13 }, 2)).toBe(true);
    expect(shouldRedock(expected, { ...expected, y: 17 }, 2)).toBe(true);
    expect(shouldRedock(expected, { ...expected, width: 67 }, 2)).toBe(true);
    expect(shouldRedock(expected, { ...expected, height: 237 }, 2)).toBe(true);
  });

  it('defaults the tolerance to 2', () => {
    expect(shouldRedock(expected, { ...expected, x: 12 })).toBe(false);
    expect(shouldRedock(expected, { ...expected, x: 13 })).toBe(true);
  });
});
