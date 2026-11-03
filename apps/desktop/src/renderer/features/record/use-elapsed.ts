import { formatRecordingClock } from '@vozella/core';
import { useEffect, useState } from 'react';

export interface ElapsedInput {
  /** The elapsed time main reported, pauses excluded. */
  readonly elapsedMs: number;
  /** The wall clock at which main computed it. */
  readonly elapsedAsOfMs: number;
  /** True while the clock runs (recording and not paused). */
  readonly isTicking: boolean;
}

/** Elapsed milliseconds at `nowMs`: main's value plus the time since, only while ticking. */
export function elapsedAt(input: ElapsedInput, nowMs: number): number {
  const extra = input.isTicking ? Math.max(0, nowMs - input.elapsedAsOfMs) : 0;
  return Math.max(0, input.elapsedMs + extra);
}

/** The `mm:ss` of the bar, redrawn once a second only while the clock runs (spec 3.6). */
export function useElapsed(input: ElapsedInput | null): string {
  const [now, setNow] = useState(() => Date.now());
  const ticking = input?.isTicking ?? false;
  const asOf = input?.elapsedAsOfMs;
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [ticking, asOf]);
  return formatRecordingClock(input ? elapsedAt(input, now) / 1000 : 0);
}
