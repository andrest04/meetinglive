import { Fragment } from 'react';
import { Kbd } from './Kbd';
import { cn } from './cn';

export interface ShortcutHintProps {
  readonly label: string;
  /** One or more chords, each a list of key caps, for example [['Ctrl', 'R']]. */
  readonly chords: readonly (readonly string[])[];
  /** Key caps sit on the dark tooltip surface by default; pass false for a light surface. */
  readonly onInk?: boolean;
}

/**
 * A tooltip body: the action name followed by its chords as key caps. Keys of one chord are
 * joined by a plus, alternative chords by a slash, so "Enter / Ctrl+Enter" reads as two ways.
 */
export function ShortcutHint({ label, chords, onInk = true }: ShortcutHintProps) {
  const separator = cn('text-caption', onInk ? 'text-on-ink-muted' : 'text-ink-muted');
  return (
    <span className="inline-flex items-center gap-2">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1">
        {chords.map((keys, chordIndex) => (
          <Fragment key={keys.join('+')}>
            {chordIndex > 0 ? (
              <span aria-hidden="true" className={separator}>
                /
              </span>
            ) : null}
            <span className="inline-flex items-center gap-0.5">
              {keys.map((cap, index) => (
                <Fragment key={`${cap}-${String(index)}`}>
                  {index > 0 ? (
                    <span aria-hidden="true" className={separator}>
                      +
                    </span>
                  ) : null}
                  <Kbd className={cn(onInk && 'border-hairline-on-ink text-on-ink-muted')}>
                    {cap}
                  </Kbd>
                </Fragment>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
