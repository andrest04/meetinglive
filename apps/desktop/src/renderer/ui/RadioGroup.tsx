import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface RadioOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
}

export interface RadioGroupProps {
  readonly options: readonly RadioOption[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Accessible name of the group. */
  readonly label: string;
  readonly orientation?: 'vertical' | 'horizontal';
  readonly className?: string;
}

export function RadioGroup({
  options,
  value,
  onValueChange,
  label,
  orientation = 'vertical',
  className,
}: RadioGroupProps) {
  return (
    <BaseRadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next);
      }}
      className={cn(
        'flex gap-2.5',
        orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap gap-x-5',
        className,
      )}
    >
      {options.map((option) => (
        <label key={option.value} className="flex items-start gap-2.5 text-ui-lg text-ink">
          <Radio.Root
            value={option.value}
            disabled={option.disabled}
            className={cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-control bg-paper',
              'transition-colors duration-150 ease-out-quick',
              'data-checked:border-ink data-disabled:cursor-not-allowed data-disabled:opacity-50',
              'forced-colors:data-checked:border-[Highlight]',
            )}
          >
            <Radio.Indicator className="block size-2 rounded-full bg-ink forced-colors:bg-[Highlight]" />
          </Radio.Root>
          <span className="flex flex-col">
            <span>{option.label}</span>
            {option.description ? (
              <span className="text-ui text-ink-muted">{option.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </BaseRadioGroup>
  );
}
