import { Field as BaseField } from '@base-ui/react/field';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface FieldProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** Plain words explaining what to fix. Shown in ink with an icon, never in a color. */
  readonly error?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

/** Label, control, help and error text wired together with the right ARIA relations. */
export function Field({ label, description, error, children, className }: FieldProps) {
  const invalid = error !== undefined && error !== null;
  return (
    <BaseField.Root invalid={invalid} className={cn('flex flex-col gap-1.5', className)}>
      <BaseField.Label className="text-ui font-medium text-ink">{label}</BaseField.Label>
      {children}
      {description ? (
        <BaseField.Description className="text-ui text-ink-muted">
          {description}
        </BaseField.Description>
      ) : null}
      <BaseField.Error match={invalid} className="flex gap-1.5 text-ui text-ink">
        <Icon icon={CircleAlert} size={14} className="mt-[3px]" />
        <span>{error}</span>
      </BaseField.Error>
    </BaseField.Root>
  );
}
