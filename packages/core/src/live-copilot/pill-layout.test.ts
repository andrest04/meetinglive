import { describe, expect, it } from 'vitest';
import {
  CAPSULE_HORIZONTAL_LONG_DIP,
  CAPSULE_SHORT_DIP,
  CAPSULE_VERTICAL_LONG_DIP,
  DRAG_THRESHOLD_DIP,
  EDGE_MARGIN_DIP,
  EXPANDED_RADIUS_DIP,
  PANEL_GAP_DIP,
  PANEL_HEIGHT_DIP,
  PANEL_SLIDE_DIP,
  PANEL_WIDTH_DIP,
  PULSE_SCALE,
  TIMINGS,
  capsuleHostMargin,
  capsuleSizePx,
  dragStarted,
  gapPx,
  marginPx,
  offscreenRect,
  panelRect,
  panelSizePx,
  roundHalfEven,
  shapeRadiusDip,
  shapeRadiusPx,
} from './pill-layout';

describe('constants (spec 2.3)', () => {
  it('match the table', () => {
    expect([CAPSULE_SHORT_DIP, CAPSULE_VERTICAL_LONG_DIP, CAPSULE_HORIZONTAL_LONG_DIP]).toEqual([
      64, 240, 272,
    ]);
    expect([EDGE_MARGIN_DIP, PANEL_WIDTH_DIP, PANEL_HEIGHT_DIP, PANEL_GAP_DIP]).toEqual([
      16, 380, 500, 8,
    ]);
    expect([EXPANDED_RADIUS_DIP, DRAG_THRESHOLD_DIP, PANEL_SLIDE_DIP, PULSE_SCALE]).toEqual([
      28, 4, 16, 1.08,
    ]);
    expect(TIMINGS).toEqual({
      snapMs: 240,
      entranceMs: 300,
      exitMs: 160,
      panelMs: 220,
      pulseMs: 180,
      startedHintMs: 2500,
      saveDebounceMs: 500,
      tickMs: 16,
    });
  });
});

describe('roundHalfEven', () => {
  it.each([
    [0.5, 0],
    [1.5, 2],
    [2.5, 2],
    [3.5, 4],
    [-1.5, -2],
    [-2.5, -2],
    [2.4, 2],
    [2.6, 3],
    [-2.6, -3],
  ])('%s -> %s', (value, expected) => {
    expect(roundHalfEven(value)).toBe(expected);
  });

  it('never returns negative zero', () => {
    expect(Object.is(roundHalfEven(-0.5), 0)).toBe(true);
  });
});

describe('pixel sizes (banker rounding at fractional DPI)', () => {
  it('scale 1 gives the DIP sizes', () => {
    expect(capsuleSizePx('Right', 1)).toEqual({ width: 64, height: 240 });
    expect(capsuleSizePx('Top', 1)).toEqual({ width: 272, height: 64 });
    expect(marginPx(1)).toBe(16);
  });

  it('scale 1.25', () => {
    expect(capsuleSizePx('Left', 1.25)).toEqual({ width: 80, height: 300 });
    expect(capsuleSizePx('Bottom', 1.25)).toEqual({ width: 340, height: 80 });
    expect(marginPx(1.25)).toBe(20);
    expect(gapPx(1.25)).toBe(10);
  });

  it('scale 1.5', () => {
    expect(capsuleSizePx('Right', 1.5)).toEqual({ width: 96, height: 360 });
    expect(capsuleSizePx('Top', 1.5)).toEqual({ width: 408, height: 96 });
    expect(marginPx(1.5)).toBe(24);
    expect(gapPx(1.5)).toBe(12);
  });

  it('midpoints round to even', () => {
    expect(gapPx(1.0625)).toBe(8); // 8.5
    expect(gapPx(1.1875)).toBe(10); // 9.5
    expect(marginPx(1.03125)).toBe(16); // 16.5
    expect(marginPx(1.09375)).toBe(18); // 17.5
  });

  it('panel size', () => {
    expect(panelSizePx(1.25)).toEqual({ width: 475, height: 625 });
    expect(panelSizePx(1)).toEqual({ width: 380, height: 500 });
  });
});

describe('capsuleHostMargin', () => {
  it('is (capsule - window) / scale', () => {
    expect(
      capsuleHostMargin(
        { x: 1840, y: 400, width: 64, height: 240 },
        { x: 1452, y: 270, width: 452, height: 500 },
        1,
      ),
    ).toEqual({ left: 388, top: 130 });
    expect(
      capsuleHostMargin(
        { x: 150, y: 100, width: 80, height: 300 },
        { x: 50, y: 20, width: 600, height: 700 },
        1.25,
      ),
    ).toEqual({ left: 80, top: 64 });
  });
});

describe('panelRect (DIP inside the window)', () => {
  const window = { x: 1452, y: 270, width: 452, height: 500 };
  const capsule = { x: 1840, y: 400, width: 64, height: 240 };

  it('Right: panel at the origin, width is window minus capsule minus gap', () => {
    expect(panelRect('Right', capsule, window, 1)).toEqual({ x: 0, y: 0, width: 380, height: 500 });
  });

  it('Left: offset by capsule width plus gap', () => {
    expect(panelRect('Left', { ...capsule, x: 16 }, { ...window, x: 16 }, 1)).toEqual({
      x: 72,
      y: 0,
      width: 380,
      height: 500,
    });
  });

  it('Top: offset by capsule height plus gap', () => {
    const w = { x: 800, y: 16, width: 380, height: 572 };
    expect(panelRect('Top', { x: 800, y: 16, width: 272, height: 64 }, w, 1)).toEqual({
      x: 0,
      y: 72,
      width: 380,
      height: 500,
    });
  });

  it('Bottom: panel at the origin', () => {
    const w = { x: 800, y: 468, width: 380, height: 572 };
    expect(panelRect('Bottom', { x: 800, y: 976, width: 272, height: 64 }, w, 1)).toEqual({
      x: 0,
      y: 0,
      width: 380,
      height: 500,
    });
  });

  it('divides by scale using the unrounded gap', () => {
    // scale 1.25: panel 475 px wide, capsule 80, gap 10 -> window 565 px.
    const r = panelRect(
      'Right',
      { x: 0, y: 0, width: 80, height: 300 },
      { x: 0, y: 0, width: 565, height: 625 },
      1.25,
    );
    expect(r).toEqual({ x: 0, y: 0, width: 380, height: 500 });
  });

  it('never goes negative', () => {
    const r = panelRect(
      'Right',
      { x: 0, y: 0, width: 80, height: 300 },
      { x: 0, y: 0, width: 60, height: 100 },
      1.25,
    );
    expect(r.width).toBe(0);
  });
});

describe('shape radius', () => {
  it('collapsed is half the short side in DIP', () => {
    expect(shapeRadiusDip(64, 240, 1, false)).toBe(32);
    expect(shapeRadiusDip(80, 300, 1.25, false)).toBe(32);
    expect(shapeRadiusDip(340, 80, 1.25, false)).toBe(32);
  });

  it('expanded is 28 DIP', () => {
    expect(shapeRadiusDip(452, 500, 1, true)).toBe(28);
    expect(shapeRadiusPx(452, 500, 1.25, true)).toBe(35);
  });

  it('pixel radius uses banker rounding', () => {
    expect(shapeRadiusPx(17, 240, 1, false)).toBe(8); // 8.5
    expect(shapeRadiusPx(19, 240, 1, false)).toBe(10); // 9.5
  });
});

describe('offscreenRect', () => {
  const docked = { x: 1000, y: 400, width: 64, height: 240 };

  it('shifts past the edge by own thickness plus margin', () => {
    expect(offscreenRect('Right', docked, 16)).toEqual({ ...docked, x: 1080 });
    expect(offscreenRect('Left', docked, 16)).toEqual({ ...docked, x: 920 });
    expect(offscreenRect('Top', docked, 16)).toEqual({ ...docked, y: 144 });
    expect(offscreenRect('Bottom', docked, 16)).toEqual({ ...docked, y: 656 });
  });
});

describe('dragStarted', () => {
  it('compares the Euclidean distance with 4 * scale in physical px', () => {
    expect(dragStarted(3, 0, 1)).toBe(false);
    expect(dragStarted(3, 3, 1)).toBe(true);
    expect(dragStarted(2, 3, 1)).toBe(false);
    expect(dragStarted(4, 0, 1)).toBe(true);
    expect(dragStarted(5, 0, 1.5)).toBe(false);
    expect(dragStarted(0, -6, 1.5)).toBe(true);
  });
});
