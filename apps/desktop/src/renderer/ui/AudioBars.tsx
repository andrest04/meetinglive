import { useEffect, useRef, useState } from 'react';
import {
  BAR_COUNT,
  BAR_GAP,
  BAR_MAX_HEIGHT,
  BAR_TICK_MS,
  BAR_WIDTH,
  snapHeights,
  tickHeights,
} from './audio-bars-math';
import { cn } from './cn';
import { useReducedMotion } from './use-reduced-motion';

export interface AudioBarsProps {
  /** 0..100. */
  readonly level: number;
  readonly paused?: boolean;
  /** The 33 ms animation runs only while true. */
  readonly running?: boolean;
  readonly className?: string;
}

/**
 * Five rounded bars that follow a level (spec 3.5, item 103). While running they ease toward the
 * target on a 33 ms timer with a little per-bar wobble; at rest, when paused, or under reduced
 * motion they snap to the target. Decorative: the level has its own named meter.
 */
export function AudioBars({ level, paused = false, running = true, className }: AudioBarsProps) {
  const reduced = useReducedMotion();
  const animate = running && !reduced;
  const [heights, setHeights] = useState<number[]>(() =>
    animate ? snapHeights(0, true) : snapHeights(level, paused),
  );
  const inputs = useRef({ level, paused });
  inputs.current = { level, paused };

  useEffect(() => {
    if (!animate) setHeights(snapHeights(level, paused));
  }, [animate, level, paused]);

  useEffect(() => {
    if (!animate) return;
    const started = performance.now();
    const timer = window.setInterval(() => {
      const seconds = (performance.now() - started) / 1000;
      setHeights((current) =>
        tickHeights(current, inputs.current.level, inputs.current.paused, seconds),
      );
    }, BAR_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [animate]);

  return (
    <div
      aria-hidden="true"
      data-testid="audio-bars"
      className={cn('flex items-center justify-center', className)}
      style={{ height: BAR_MAX_HEIGHT, gap: BAR_GAP }}
    >
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <span
          key={i}
          data-bar=""
          className="rounded-[1.5px] bg-ink forced-colors:bg-[CanvasText]"
          style={{ width: BAR_WIDTH, height: heights[i] }}
        />
      ))}
    </div>
  );
}
