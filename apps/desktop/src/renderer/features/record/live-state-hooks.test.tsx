// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { elapsedAt, useElapsed } from './use-elapsed';
import { STICK_THRESHOLD, isStuck } from './use-follow-scroll';
import { useHeldValue } from './use-live-text';
import { matchShortcut, useRecordShortcuts } from './use-record-shortcuts';
import { useTimedValue } from './use-timed-value';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('isStuck (item 107)', () => {
  const area = (scrollTop: number, scrollHeight = 1000, clientHeight = 200) => ({
    scrollTop,
    scrollHeight,
    clientHeight,
  });

  it('is stuck when the content does not scroll', () => {
    expect(isStuck(area(0, 150, 200))).toBe(true);
    expect(isStuck(area(0, 200, 200))).toBe(true);
  });

  it('sticks within 32 px of the end and lets go beyond it', () => {
    expect(STICK_THRESHOLD).toBe(32);
    expect(isStuck(area(800))).toBe(true);
    expect(isStuck(area(768))).toBe(true);
    expect(isStuck(area(767))).toBe(false);
    expect(isStuck(area(0))).toBe(false);
  });
});

describe('useHeldValue (item 106)', () => {
  it('passes the value through while not held', () => {
    const { result, rerender } = renderHook(({ v, h }) => useHeldValue(v, h), {
      initialProps: { v: 'a', h: false },
    });
    rerender({ v: 'b', h: false });
    expect(result.current).toBe('b');
  });

  it('keeps the old value while held and refreshes when the hold ends', () => {
    const { result, rerender } = renderHook(({ v, h }) => useHeldValue(v, h), {
      initialProps: { v: 'a', h: false },
    });
    rerender({ v: 'a', h: true });
    rerender({ v: 'b', h: true });
    rerender({ v: 'c', h: true });
    expect(result.current).toBe('a');
    rerender({ v: 'c', h: false });
    expect(result.current).toBe('c');
  });
});

describe('elapsed time', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
  });

  it('adds the time since main spoke only while the clock ticks', () => {
    const base = { elapsedMs: 5_000, elapsedAsOfMs: 10_000 };
    expect(elapsedAt({ ...base, isTicking: true }, 12_500)).toBe(7_500);
    expect(elapsedAt({ ...base, isTicking: false }, 12_500)).toBe(5_000);
    expect(elapsedAt({ ...base, isTicking: true }, 9_000)).toBe(5_000);
  });

  it('draws mm:ss, redraws every second while ticking and freezes while paused', () => {
    const { result, rerender } = renderHook(({ input }) => useElapsed(input), {
      initialProps: { input: { elapsedMs: 59_000, elapsedAsOfMs: 10_000, isTicking: true } },
    });
    expect(result.current).toBe('00:59');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe('01:01');
    rerender({ input: { elapsedMs: 61_000, elapsedAsOfMs: 12_000, isTicking: false } });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe('01:01');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runs past 59 minutes without wrapping', () => {
    const { result } = renderHook(() =>
      useElapsed({ elapsedMs: 125 * 60_000 + 30_000, elapsedAsOfMs: 10_000, isTicking: false }),
    );
    expect(result.current).toBe('125:30');
  });
});

describe('useTimedValue (items 68 and 70)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('clears after the delay and restarts the single timer on every show', () => {
    const { result } = renderHook(() => useTimedValue<string>(2000));
    act(() => {
      result.current.show('one');
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    act(() => {
      result.current.show('two');
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current.value).toBe('two');
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.value).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops its timer when the component goes away', () => {
    const { result, unmount } = renderHook(() => useTimedValue<string>(2000));
    act(() => {
      result.current.show('x');
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('accelerators (spec 2.6)', () => {
  const key = (init: Partial<KeyboardEventInit> & { key: string }) => ({
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...init,
  });

  it('maps Ctrl+R, Ctrl+P and Ctrl+Shift+D and nothing else', () => {
    expect(matchShortcut(key({ key: 'r', ctrlKey: true }))).toBe('stop');
    expect(matchShortcut(key({ key: 'R', ctrlKey: true }))).toBe('stop');
    expect(matchShortcut(key({ key: 'p', ctrlKey: true }))).toBe('pause');
    expect(matchShortcut(key({ key: 'd', ctrlKey: true, shiftKey: true }))).toBe('discard');
    expect(matchShortcut(key({ key: 'D', ctrlKey: true, shiftKey: true }))).toBe('discard');
    expect(matchShortcut(key({ key: 'd', ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'r', ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: 'r' }))).toBeNull();
    expect(matchShortcut(key({ key: 'r', ctrlKey: true, altKey: true }))).toBeNull();
  });

  function Probe({ enabled, run }: { enabled: boolean; run: () => void }) {
    useRecordShortcuts({
      stop: { enabled, run },
      pause: { enabled, run: () => undefined },
      discard: { enabled, run: () => undefined },
    });
    return null;
  }

  it('runs the action when enabled', () => {
    const run = vi.fn();
    render(<Probe enabled run={run} />);
    const event = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('marks the event handled even when the action is disabled', () => {
    const run = vi.fn();
    render(<Probe enabled={false} run={run} />);
    const event = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, cancelable: true });
    document.dispatchEvent(event);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves other keys alone and stops listening on unmount', () => {
    const run = vi.fn();
    const view = render(<Probe enabled run={run} />);
    const plain = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    document.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    view.unmount();
    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
  });
});
