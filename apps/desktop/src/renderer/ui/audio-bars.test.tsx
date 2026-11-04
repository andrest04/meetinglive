// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioBars } from './AudioBars';
import {
  ATTACK,
  BAR_PROFILE,
  DECAY,
  barPhase,
  barTarget,
  easeBar,
  levelFraction,
  snapHeights,
  tickHeights,
} from './audio-bars-math';

describe('audio bars math (spec 3.5, item 103)', () => {
  it('keeps the profile, phase steps and speeds of the spec', () => {
    expect(BAR_PROFILE).toEqual([0.55, 0.8, 1.0, 0.8, 0.55]);
    expect(barPhase(0, 0)).toBeCloseTo(0.75, 10);
    expect(barPhase(1, 1)).toBeCloseTo(0.75 + 0.25 * Math.sin(1.3 + 9.5), 10);
    expect(barPhase(4, 2)).toBeCloseTo(0.75 + 0.25 * Math.sin(5.2 + 15), 10);
  });

  it('rests at 3 px and tops out at 24 px', () => {
    expect(barTarget(2, 0, false, 1)).toBe(3);
    expect(barTarget(2, 100, false, 1)).toBe(24);
    expect(barTarget(0, 100, false, 1)).toBeCloseTo(3 + 21 * 0.55, 10);
  });

  it('treats paused and non-finite levels as flat and clamps the range', () => {
    expect(levelFraction(80, true)).toBe(0);
    expect(levelFraction(Number.NaN, false)).toBe(0);
    expect(levelFraction(Number.POSITIVE_INFINITY, false)).toBe(0);
    expect(levelFraction(250, false)).toBe(1);
    expect(levelFraction(-5, false)).toBe(0);
    expect(snapHeights(90, true)).toEqual([3, 3, 3, 3, 3]);
  });

  it('eases up with 0.55 and down with 0.14, rounded to a tenth', () => {
    expect(ATTACK).toBe(0.55);
    expect(DECAY).toBe(0.14);
    expect(easeBar(3, 24)).toBe(Math.round((3 + 21 * 0.55) * 10) / 10);
    expect(easeBar(24, 3)).toBe(Math.round((24 - 21 * 0.14) * 10) / 10);
    expect(easeBar(10, 10)).toBe(10);
  });

  it('ticks all five bars together', () => {
    const next = tickHeights([3, 3, 3, 3, 3], 100, false, 0);
    expect(next).toHaveLength(5);
    expect(next[2]).toBeGreaterThan(next[0] ?? 0);
  });
});

const setMotion = (reduced: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
};

const heights = (): number[] =>
  Array.from(screen.getByTestId('audio-bars').querySelectorAll('[data-bar]')).map((bar) =>
    Number.parseFloat((bar as HTMLElement).style.height),
  );

describe('AudioBars', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders five decorative bars', () => {
    setMotion(false);
    render(<AudioBars level={0} running={false} />);
    expect(heights()).toEqual([3, 3, 3, 3, 3]);
    expect(screen.getByTestId('audio-bars')).toHaveAttribute('aria-hidden', 'true');
  });

  it('snaps to the target when not running', () => {
    setMotion(false);
    render(<AudioBars level={100} running={false} />);
    expect(heights()).toEqual(snapHeights(100, false).map((h) => h));
  });

  it('snaps under reduced motion even while running, with no timer', () => {
    setMotion(true);
    render(<AudioBars level={100} running />);
    expect(vi.getTimerCount()).toBe(0);
    expect(heights()[2]).toBe(24);
  });

  it('eases on a 33 ms timer while running and stops the timer on unmount', () => {
    setMotion(false);
    const view = render(<AudioBars level={100} running />);
    expect(vi.getTimerCount()).toBe(1);
    expect(heights()[2]).toBe(3);
    act(() => {
      vi.advanceTimersByTime(33);
    });
    const first = heights()[2] ?? 0;
    expect(first).toBeGreaterThan(3);
    act(() => {
      vi.advanceTimersByTime(330);
    });
    expect(heights()[2] ?? 0).toBeGreaterThan(first);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls flat while paused', () => {
    setMotion(false);
    const view = render(<AudioBars level={100} running />);
    act(() => {
      vi.advanceTimersByTime(660);
    });
    view.rerender(<AudioBars level={100} running paused />);
    act(() => {
      vi.advanceTimersByTime(3300);
    });
    for (const h of heights()) expect(h).toBeLessThan(3.5);
  });
});
