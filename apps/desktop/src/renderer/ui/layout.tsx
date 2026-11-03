import { useId, type ReactNode } from 'react';
import { cn } from './cn';

export function SectionHeader({
  title,
  description,
  action,
  icon,
  level = 2,
  quiet = false,
  compact = false,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** A decorative mark before the title. */
  icon?: ReactNode;
  level?: 1 | 2 | 3;
  /** A page of lists and settings: the heading keeps its level but not the document's large title. */
  quiet?: boolean;
  /** A section inside a long page: reading size, so the page title keeps its place above it. */
  compact?: boolean;
  className?: string;
}) {
  const Heading = `h${level}` as const;
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Heading
          className={cn(
            'font-semibold tracking-[-0.01em] text-ink',
            level === 1 && !quiet
              ? 'text-title tracking-[-0.02em]'
              : level === 3
                ? 'text-ui-lg'
                : compact
                  ? 'text-read-lg'
                  : 'text-heading',
          )}
        >
          {icon ? (
            <span className="inline-flex items-center gap-2">
              {icon}
              {title}
            </span>
          ) : (
            title
          )}
        </Heading>
        {description ? <p className="text-ui-lg text-ink-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/** One setting: words on the left, the control on the right, a hairline between rows. */
export function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** The control. Give it the accessible name through the title id passed to the render prop. */
  children: ReactNode | ((ids: { titleId: string; descriptionId: string }) => ReactNode);
  className?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        'flex items-center justify-between gap-6 border-b border-hairline py-3.5 last:border-b-0',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={titleId} className="text-ui-lg font-medium text-ink">
          {title}
        </span>
        {description ? (
          <span id={descriptionId} className="max-w-prose text-ui text-ink-muted">
            {description}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {typeof children === 'function' ? children({ titleId, descriptionId }) : children}
      </div>
    </div>
  );
}

/** One quiet line and, at most, one action. No illustration. */
export function EmptyState({
  message,
  action,
  className,
}: {
  message: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-3 py-8', className)}>
      <p className="text-read text-ink-muted">{message}</p>
      {action}
    </div>
  );
}
