import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../ui';

export interface Choice {
  readonly key: string;
  /** Accessible name. */
  readonly label: string;
  readonly content: ReactNode;
}

export interface ChoiceGridProps {
  readonly choices: readonly Choice[];
  readonly value: string;
  readonly onValueChange: (key: string) => void;
  /** Accessible name of the group. */
  readonly label: string;
  readonly variant: 'swatch' | 'tile';
  readonly className?: string;
}

/** One radio group drawn as a grid. One tab stop; arrows move and select, as radios do. */
export function ChoiceGrid({
  choices,
  value,
  onValueChange,
  label,
  variant,
  className,
}: ChoiceGridProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const selectedIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.key === value),
  );

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = choices[(index + step + choices.length) % choices.length];
    if (!next) return;
    onValueChange(next.key);
    refs.current.get(next.key)?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {choices.map((choice, index) => {
        const checked = choice.key === value;
        return (
          <button
            key={choice.key}
            ref={(element) => {
              if (element) refs.current.set(choice.key, element);
              else refs.current.delete(choice.key);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={choice.label}
            title={choice.label}
            tabIndex={index === selectedIndex ? 0 : -1}
            onClick={() => {
              onValueChange(choice.key);
            }}
            onKeyDown={(event) => {
              move(event, index);
            }}
            className={cn(
              'flex shrink-0 items-center justify-center transition-colors duration-150 ease-out-quick',
              variant === 'swatch'
                ? cn(
                    'size-7 rounded-full',
                    checked ? 'border-2 border-ink' : 'border border-transparent',
                  )
                : cn(
                    'size-9 rounded-control border',
                    checked
                      ? 'border-ink bg-pressed text-ink'
                      : 'border-hairline text-ink-muted hover:bg-hover',
                  ),
              'forced-colors:aria-checked:border-[Highlight] forced-colors:aria-checked:border-2',
            )}
          >
            {choice.content}
          </button>
        );
      })}
    </div>
  );
}
