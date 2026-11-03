import { useRef, type KeyboardEvent } from 'react';
import { cn } from '../../ui';
import type { NotesMode } from './summary-tab-model';

export interface ModeSwitchProps {
  readonly value: NotesMode;
  readonly onChange: (mode: NotesMode) => void;
  readonly label: string;
  readonly labels: Readonly<Record<NotesMode, string>>;
}

const ORDER: readonly NotesMode[] = ['notes', 'enhanced'];

/** Two choices in one hairline frame. Arrow keys move and select, as in a native radio group. */
export function ModeSwitch({ value, onChange, label, labels }: ModeSwitchProps) {
  const refs = useRef<Record<NotesMode, HTMLButtonElement | null>>({
    notes: null,
    enhanced: null,
  });
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = ORDER[(ORDER.indexOf(value) + step + ORDER.length) % ORDER.length] ?? value;
    onChange(next);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex rounded-control border border-border-control p-0.5"
    >
      {ORDER.map((mode) => {
        const selected = mode === value;
        return (
          <button
            key={mode}
            ref={(node) => {
              refs.current[mode] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onChange(mode);
            }}
            className={cn(
              'h-6 rounded-[3px] px-3 text-ui select-none',
              'transition-colors duration-150 ease-out-quick',
              selected
                ? 'bg-hover font-medium text-ink forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {labels[mode]}
          </button>
        );
      })}
    </div>
  );
}
