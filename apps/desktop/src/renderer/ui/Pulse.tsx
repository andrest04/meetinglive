import type { CSSProperties } from 'react';
import { cn } from './cn';
import { useReducedMotion } from './use-reduced-motion';

export interface PulseProps {
  /** Recording and not paused: the halo pulses. Otherwise only the dot shows. */
  readonly active: boolean;
  readonly className?: string;
}

/** Halo opacity: 0.15 to 0.45 over 1.2 s (items 63, 193). Static 0.3 under reduced motion. */
export const PULSE_STATIC_OPACITY = 0.3;
export const PULSE_PERIOD = '1.2s';

/**
 * The red dot of a live recording with its halo. The signal color means recording and nothing
 * else. Paused: the halo is gone and the dot stays. The element is decorative; the state is said
 * in words next to it.
 */
export function Pulse({ active, className }: PulseProps) {
  const reduced = useReducedMotion();
  const halo: CSSProperties = !active
    ? { opacity: 0 }
    : reduced
      ? { opacity: PULSE_STATIC_OPACITY, animation: 'none' }
      : { animation: `halo-pulse ${PULSE_PERIOD} ease-in-out infinite alternate` };
  return (
    <span
      aria-hidden="true"
      data-testid="pulse"
      data-active={active ? 'true' : 'false'}
      className={cn(
        'relative inline-flex size-[18px] shrink-0 items-center justify-center',
        className,
      )}
    >
      <span
        data-testid="pulse-halo"
        className="absolute inset-0 rounded-full bg-signal forced-colors:bg-[Highlight]"
        style={halo}
      />
      <span className="relative size-2.5 rounded-full bg-signal forced-colors:bg-[Highlight]" />
    </span>
  );
}
