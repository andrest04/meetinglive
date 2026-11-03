import { Progress as BaseProgress } from '@base-ui/react/progress';
import { cn } from './cn';

export interface ProgressProps {
  /** 0 to 100, or null when the length of the work is not known. */
  readonly value: number | null;
  readonly label: string;
  /** Shows the percentage next to the label. */
  readonly showValue?: boolean;
  readonly className?: string;
}

export function Progress({ value, label, showValue = false, className }: ProgressProps) {
  return (
    <BaseProgress.Root value={value} className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex justify-between text-ui text-ink-muted">
        <BaseProgress.Label>{label}</BaseProgress.Label>
        {showValue && value !== null ? (
          <BaseProgress.Value className="font-mono tabular-nums" />
        ) : null}
      </div>
      <BaseProgress.Track className="relative h-1 overflow-hidden rounded-full bg-hairline forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-transparent">
        <BaseProgress.Indicator
          className={cn(
            'h-full rounded-full bg-ink transition-[width] duration-150 ease-out-quick forced-colors:bg-[Highlight]',
            'data-indeterminate:w-2/5 data-indeterminate:animate-indeterminate',
          )}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
