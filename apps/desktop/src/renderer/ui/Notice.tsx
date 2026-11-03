import { CircleAlert, Info, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import { Icon } from './Icon';

export interface NoticeProps {
  readonly children: ReactNode;
  /** `warning` interrupts politely (role status); both look the same: ink on a hairline box. */
  readonly tone?: 'info' | 'warning';
  /** When given, a close button appears. */
  readonly onDismiss?: () => void;
  readonly dismissLabel?: string;
  readonly className?: string;
}

/** An inline message inside a page. Plain words and a glyph; no color carries the meaning. */
export function Notice({
  children,
  tone = 'info',
  onDismiss,
  dismissLabel,
  className,
}: NoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex items-start gap-2.5 rounded-control border border-hairline bg-paper-raised py-2 ps-3 pe-2 text-ui-lg text-ink',
        'forced-colors:border-[CanvasText]',
        className,
      )}
    >
      <Icon icon={tone === 'warning' ? CircleAlert : Info} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 py-px break-words">{children}</div>
      {onDismiss && dismissLabel ? (
        <IconButton
          label={dismissLabel}
          icon={X}
          size="sm"
          tooltip={false}
          onClick={onDismiss}
          className="-my-0.5 shrink-0"
        />
      ) : null}
    </div>
  );
}
