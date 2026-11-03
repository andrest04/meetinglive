import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from './cn';

export interface RadioOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  /** Controls that sit beside the option, outside its label (buttons, badges). Rows layout only. */
  readonly trailing?: ReactNode;
}

export interface RadioGroupProps {
  readonly options: readonly RadioOption[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** Accessible name of the group. */
  readonly label: string;
  readonly orientation?: 'vertical' | 'horizontal';
  /** `rows`: each option is a full-width row with a hairline between, and `trailing` on the right. */
  readonly layout?: 'stack' | 'rows';
  readonly className?: string;
}

export function RadioGroup({
  options,
  value,
  onValueChange,
  label,
  orientation = 'vertical',
  layout = 'stack',
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
        layout === 'rows'
          ? 'flex-col gap-0'
          : orientation === 'vertical'
            ? 'flex-col'
            : 'flex-row flex-wrap gap-x-5',
        className,
      )}
    >
      {options.map((option) => {
        const item = (
          <label className="flex min-w-0 items-start gap-2.5 text-ui-lg text-ink">
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
        );
        if (layout !== 'rows')
          return (
            <div key={option.value} className="contents">
              {item}
            </div>
          );
        return (
          <div
            key={option.value}
            className="flex items-center justify-between gap-4 border-b border-hairline py-3 last:border-b-0"
          >
            {item}
            {option.trailing ? (
              <div className="flex shrink-0 items-center gap-2">{option.trailing}</div>
            ) : null}
          </div>
        );
      })}
    </BaseRadioGroup>
  );
}
