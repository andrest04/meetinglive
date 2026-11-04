import { describe, expect, it } from 'vitest';
import { clamp, popupBounds, topRight } from './popup-placement';

describe('MeetingPromptPlacementTests', () => {
  it('places the popup at the top right with the margin', () => {
    expect(topRight(480, 72, { x: 0, y: 0, width: 1920, height: 1080 }, 24)).toEqual({
      x: 1416,
      y: 24,
    });
  });

  it('respects a work area that does not start at the origin', () => {
    expect(topRight(480, 72, { x: -1920, y: 40, width: 1920, height: 1040 }, 24)).toEqual({
      x: -504,
      y: 64,
    });
  });

  it('stays inside the area when the margin does not fit', () => {
    expect(topRight(480, 72, { x: 100, y: 50, width: 500, height: 80 }, 24)).toEqual({
      x: 100,
      y: 58,
    });
    expect(topRight(480, 72, { x: 10, y: 20, width: 300, height: 40 }, 24)).toEqual({
      x: 10,
      y: 20,
    });
  });

  it('scales size with ceil and margin with floor', () => {
    expect(popupBounds({ x: 0, y: 0, width: 3000, height: 2000 }, 1.25)).toEqual({
      x: 3000 - 600 - 30,
      y: 30,
      width: 600,
      height: 90,
    });
    expect(popupBounds({ x: 0, y: 0, width: 3000, height: 2000 }, 1.15)).toMatchObject({
      width: 552,
      height: 83,
      y: 27,
    });
  });
});

describe('LiveCopilotPillPlacementTests (clamp)', () => {
  const area = { x: 100, y: 50, width: 1000, height: 600 };
  it('leaves a box that is inside the area where it is', () => {
    expect(clamp(300, 200, 100, 40, area)).toEqual({ x: 300, y: 200 });
  });
  it('pulls a box that is outside back to the nearest edge', () => {
    expect(clamp(-500, 9000, 100, 40, area)).toEqual({ x: 100, y: 610 });
    expect(clamp(9000, -500, 100, 40, area)).toEqual({ x: 1000, y: 50 });
  });
  it('works from a non-zero origin', () => {
    expect(clamp(0, 0, 100, 40, area)).toEqual({ x: 100, y: 50 });
  });
  it('pins a box larger than the area to the area origin', () => {
    expect(clamp(400, 300, 2000, 900, area)).toEqual({ x: 100, y: 50 });
  });
  it('a box exactly filling the area has only one place to be', () => {
    expect(clamp(777, 333, 1000, 600, area)).toEqual({ x: 100, y: 50 });
  });
});
