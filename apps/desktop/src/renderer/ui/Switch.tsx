import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export interface SwitchProps extends Omit<
  ComponentProps<typeof BaseSwitch.Root>,
  'children' | 'render' | 'className'
> {
  readonly className?: string;
  readonly label: ReactNode;
}

export function Switch({ label, className, ...rest }: SwitchProps) {
  return (
    <label className={cn('inline-flex items-center gap-2.5 text-ui-lg text-ink', className)}>
      <BaseSwitch.Root
        className={cn(
          'relative flex h-[18px] w-8 shrink-0 items-center rounded-full border border-border-control bg-paper p-px',
          'transition-colors duration-150 ease-out-quick',
          'data-checked:border-ink data-checked:bg-ink',
          'data-disabled:cursor-not-allowed data-disabled:opacity-50',
          'forced-colors:data-checked:border-[Highlight] forced-colors:data-checked:bg-[Highlight]',
        )}
        {...rest}
      >
        <BaseSwitch.Thumb
          className={cn(
            'block size-3 translate-x-px rounded-full bg-ink-muted transition-[translate,background-color] duration-150 ease-out-quick',
            'data-checked:translate-x-[14px] data-checked:bg-on-ink',
            'forced-colors:bg-[CanvasText] forced-colors:data-checked:bg-[HighlightText]',
          )}
        />
      </BaseSwitch.Root>
      <span>{label}</span>
    </label>
  );
}
