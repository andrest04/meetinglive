import { cn } from './cn';

export interface MeterProps {
  /** 0 to 100. */
  readonly value: number;
  /** Accessible name. */
  readonly label: string;
  readonly className?: string;
}

/**
 * A live level: a thin hairline track and an ink bar. Not a progress bar, so it has role
 * `meter`. The width is the only moving part and it is not animated, because a level that
 * lags behind the sound is wrong.
 */
export function Meter({ value, label, className }: MeterProps) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn(
        'relative h-1 overflow-hidden rounded-full bg-hairline',
        'forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-transparent',
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-ink forced-colors:bg-[Highlight]"
        style={{ width: `${String(clamped)}%` }}
      />
    </div>
  );
}
