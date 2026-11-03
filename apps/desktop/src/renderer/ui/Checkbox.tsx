import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Check, Minus } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface CheckboxProps extends Omit<
  ComponentProps<typeof BaseCheckbox.Root>,
  'children' | 'render' | 'className'
> {
  readonly className?: string;
  readonly label: ReactNode;
  readonly description?: ReactNode;
}

export function Checkbox({ label, description, className, ...rest }: CheckboxProps) {
  return (
    <label className={cn('flex items-start gap-2.5 text-ui-lg text-ink', className)}>
      <BaseCheckbox.Root
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-control border border-border-control bg-paper text-on-ink',
          'transition-colors duration-150 ease-out-quick',
          'data-checked:border-ink data-checked:bg-ink data-indeterminate:border-ink data-indeterminate:bg-ink',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50',
          'forced-colors:text-[HighlightText] forced-colors:data-checked:bg-[Highlight] forced-colors:data-indeterminate:bg-[Highlight]',
        )}
        {...rest}
      >
        <BaseCheckbox.Indicator
          render={(props, state) => (
            <span {...props} className="flex">
              <Icon icon={state.indeterminate ? Minus : Check} size={12} />
            </span>
          )}
        />
      </BaseCheckbox.Root>
      <span className="flex flex-col">
        <span>{label}</span>
        {description ? <span className="text-ui text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
