import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALONG,
  DEFAULT_EDGE,
  alongFor,
  expandedBounds,
  isVertical,
  nearestEdge,
  parseEdge,
  positionFor,
  travelRange,
  type DockEdge,
} from './pill-dock';

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const margin = 12;

describe('LiveCopilotPillDockTests', () => {
  it.each([
    ['Left', true],
    ['Right', true],
    ['Top', false],
    ['Bottom', false],
  ] as const)('isVertical %s is %s', (edge, expected) => {
    expect(isVertical(edge)).toBe(expected);
  });

  it('defaults to the right edge, centered', () => {
    expect(DEFAULT_EDGE).toBe('Right');
    expect(DEFAULT_ALONG).toBe(0.5);
  });

  it.each([
    [20, 500, 'Left'],
    [1900, 500, 'Right'],
    [900, 10, 'Top'],
    [900, 1030, 'Bottom'],
  ] as const)('nearestEdge (%s,%s) is %s', (cx, cy, expected) => {
    expect(nearestEdge(cx, cy, area)).toBe(expected);
  });

  it('nearestEdge at the screen center snaps to top or bottom', () => {
    expect(['Top', 'Bottom']).toContain(nearestEdge(960, 520, area));
  });

  it('nearestEdge ties prefer Right, then Left, then Bottom, then Top', () => {
    const square = { x: 0, y: 0, width: 1000, height: 1000 };
    expect(nearestEdge(500, 500, square)).toBe('Right');
    expect(nearestEdge(100, 100, square)).toBe('Left');
    expect(nearestEdge(100, 900, square)).toBe('Left');
    expect(nearestEdge(900, 900, square)).toBe('Right');
    expect(nearestEdge(500, 100, square)).toBe('Top');
    // Bottom beats Top on an exact tie when both are closer than Left and Right.
    expect(nearestEdge(1000, 500, { x: 0, y: 0, width: 2000, height: 1000 })).toBe('Bottom');
  });

  it('nearestEdge is relative to the area origin', () => {
    expect(nearestEdge(-1900, 500, { x: -1920, y: 0, width: 1920, height: 1040 })).toBe('Left');
  });

  it('travelRange never goes below zero', () => {
    expect(travelRange(1040, 240, 16)).toBe(768);
    expect(travelRange(300, 400, 12)).toBe(0);
  });

  it('positionFor Right centered hugs the right with the margin', () => {
    expect(positionFor('Right', 0.5, 64, 184, area, margin)).toEqual({
      x: 1920 - 64 - margin,
      y: margin + (1040 - 184 - 2 * margin) / 2,
    });
  });

  it('positionFor Left hugs the left', () => {
    expect(positionFor('Left', 0, 64, 184, area, margin)).toEqual({ x: margin, y: margin });
  });

  it('positionFor Top slides along x', () => {
    expect(positionFor('Top', 1, 184, 64, area, margin)).toEqual({
      x: 1920 - 184 - margin,
      y: margin,
    });
  });

  it('positionFor Bottom hugs the bottom', () => {
    expect(positionFor('Bottom', 0, 184, 64, area, margin)).toEqual({
      x: margin,
      y: 1040 - 64 - margin,
    });
  });

  it('positionFor offsets from a non-zero origin', () => {
    expect(
      positionFor('Left', 0, 64, 184, { x: -1920, y: 100, width: 1920, height: 1040 }, margin),
    ).toEqual({ x: -1920 + margin, y: 100 + margin });
  });

  it.each([-3, 7, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'positionFor along %s stays inside the area',
    (along) => {
      const p = positionFor('Right', along, 64, 184, area, margin);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + 184).toBeLessThanOrEqual(1040);
    },
  );

  it('positionFor maps NaN and infinity to the center', () => {
    const center = positionFor('Right', 0.5, 64, 184, area, margin);
    expect(positionFor('Right', Number.NaN, 64, 184, area, margin)).toEqual(center);
    expect(positionFor('Right', Number.POSITIVE_INFINITY, 64, 184, area, margin)).toEqual(center);
  });

  it('positionFor pins a capsule that does not fit to the start', () => {
    const small = { x: 0, y: 0, width: 500, height: 300 };
    expect(positionFor('Right', 0.5, 64, 400, small, margin).y).toBe(margin);
  });

  it('positionFor rounds half to even (item 40)', () => {
    // travel = 1296 - 240 - 32 = 1024, a power of two, so along = offset / 1024 is exact.
    const tall = { x: 0, y: 0, width: 1920, height: 1296 };
    const at = (offset: number) => positionFor('Left', offset / 1024, 64, 240, tall, 16).y - 16;
    expect(at(0.5)).toBe(0);
    expect(at(1.5)).toBe(2);
    expect(at(2.5)).toBe(2);
    expect(at(3.5)).toBe(4);
  });

  it.each([
    ['Right', 0],
    ['Right', 0.5],
    ['Right', 1],
    ['Left', 0.25],
  ] as const)('alongFor round trips vertical %s %s', (edge, along) => {
    const p = positionFor(edge, along, 64, 184, area, margin);
    expect(alongFor(edge, p.x, p.y, 64, 184, area, margin)).toBeCloseTo(along, 2);
  });

  it.each([
    ['Top', 0],
    ['Top', 0.75],
    ['Bottom', 1],
    ['Bottom', 0.4],
  ] as const)('alongFor round trips horizontal %s %s', (edge, along) => {
    const p = positionFor(edge, along, 184, 64, area, margin);
    expect(alongFor(edge, p.x, p.y, 184, 64, area, margin)).toBeCloseTo(along, 2);
  });

  it('alongFor clamps past the ends', () => {
    expect(alongFor('Right', 0, -500, 64, 184, area, margin)).toBe(0);
    expect(alongFor('Right', 0, 5000, 64, 184, area, margin)).toBe(1);
  });

  it('alongFor returns 0.5 when there is no travel', () => {
    const small = { x: 0, y: 0, width: 500, height: 300 };
    expect(alongFor('Right', 0, 0, 64, 400, small, margin)).toBe(0.5);
  });
});

describe('expandedBounds', () => {
  const expanded = (edge: DockEdge, x: number, y: number, w: number, h: number) =>
    expandedBounds(edge, { x, y, width: w, height: h }, 380, 500, 8, area);

  it('Right keeps the capsule on the right and grows toward the center', () => {
    const b = expanded('Right', 1920 - 64 - 12, 400, 64, 240);
    expect(b.width).toBe(452);
    expect(b.height).toBe(500);
    expect(b.x + b.width).toBe(1920 - 12);
    expect(b.y + b.height / 2).toBe(400 + 120);
  });

  it('Left keeps the capsule on the left', () => {
    const b = expanded('Left', 12, 400, 64, 240);
    expect(b.x).toBe(12);
    expect(b.width).toBe(452);
  });

  it('Top opens below the capsule', () => {
    const b = expanded('Top', 800, 12, 272, 64);
    expect(b.y).toBe(12);
    expect(b.height).toBe(64 + 8 + 500);
    expect(b.width).toBe(380);
  });

  it('Bottom opens above the capsule', () => {
    const y = 1040 - 64 - 12;
    const b = expanded('Bottom', 800, y, 272, 64);
    expect(b.y + b.height).toBe(y + 64);
    expect(b.height).toBe(572);
  });

  it('a capsule near the end is shifted back inside the area', () => {
    const b = expanded('Right', 1920 - 64 - 12, 1040 - 240 - 12, 64, 240);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(1040);
    expect(b.height).toBe(500);
  });

  it('a panel larger than the area shrinks to the area', () => {
    const b = expandedBounds('Right', { x: 400, y: 50, width: 64, height: 240 }, 380, 500, 8, {
      x: 0,
      y: 0,
      width: 500,
      height: 300,
    });
    expect(b.width).toBeLessThanOrEqual(500);
    expect(b.height).toBeLessThanOrEqual(300);
  });

  it('spec worked example: Right 1840,400 expands to 1452,270', () => {
    const capsule = positionFor('Right', 0.5, 64, 240, area, 16);
    expect(capsule).toEqual({ x: 1840, y: 400 });
    expect(
      expandedBounds('Right', { ...capsule, width: 64, height: 240 }, 380, 500, 8, area),
    ).toEqual({ x: 1452, y: 270, width: 452, height: 500 });
  });

  it('spec worked example: Top along 0.5 is at 824,16', () => {
    expect(positionFor('Top', 0.5, 272, 64, area, 16)).toEqual({ x: 824, y: 16 });
  });

  it('truncates toward zero when centering: -259 / 2 is -129', () => {
    const big = { x: 0, y: 0, width: 4000, height: 4000 };
    // Capsule 241 tall, panel 500 tall: (241 - 500) / 2 = -129.5 truncates to -129.
    const v = expandedBounds(
      'Right',
      { x: 2000, y: 1000, width: 64, height: 241 },
      380,
      500,
      8,
      big,
    );
    expect(v.y).toBe(1000 - 129);
    // (272 - 531) / 2 = -129.5 truncates to -129.
    const h = expandedBounds('Top', { x: 2000, y: 1000, width: 272, height: 64 }, 531, 500, 8, big);
    expect(h.x).toBe(2000 - 129);
  });
});

describe('parseEdge', () => {
  it.each([
    ['Left', 'Left'],
    ['right', 'Right'],
    ['TOP', 'Top'],
    ['Bottom', 'Bottom'],
    [null, 'Right'],
    [undefined, 'Right'],
    ['', 'Right'],
    ['diagonal', 'Right'],
    ['7', 'Right'],
  ] as const)('%s parses to %s', (raw, expected) => {
    expect(parseEdge(raw)).toBe(expected);
  });

  it('bug 5: numeric strings and comma flags fall back to Right', () => {
    expect(parseEdge('0')).toBe('Right');
    expect(parseEdge('2')).toBe('Right');
    expect(parseEdge('Left,Top')).toBe('Right');
    expect(parseEdge(' Left ')).toBe('Right');
  });
});
