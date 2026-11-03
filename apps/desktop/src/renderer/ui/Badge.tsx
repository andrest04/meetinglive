import type { ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'outline' | 'live';

const tones: Record<BadgeTone, string> = {
  neutral: 'border-transparent bg-paper-raised text-ink-muted',
  outline: 'border-border-control bg-transparent text-ink-muted',
  live: 'border-transparent bg-transparent text-ink',
};

/**
 * Small status label. Only the live tone carries the signal color, as a dot, and only
 * for an active recording: color is never the sole carrier, the word is always there.
 */
export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded-control border px-1.5 text-caption font-medium whitespace-nowrap',
        'forced-colors:border-[CanvasText]',
        tones[tone],
        className,
      )}
    >
      {tone === 'live' ? (
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-signal forced-colors:bg-[Highlight]"
        />
      ) : null}
      {children}
    </span>
  );
}
