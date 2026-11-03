import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import { popupColors, popupSurface } from './styles';

export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly closeLabel: string;
  readonly children?: ReactNode;
  /** Buttons, right aligned. The primary action goes last. */
  readonly actions?: ReactNode;
}

/** Modal: focus is trapped, Escape closes, focus returns to what opened it. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  actions,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop
          className={cn(
            'fixed inset-0 z-40 bg-scrim transition-opacity duration-150 ease-out-quick',
            'data-starting-style:opacity-0 data-ending-style:opacity-0',
          )}
        />
        <BaseDialog.Popup
          className={cn(
            popupSurface,
            popupColors,
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-4rem)] w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 p-5',
            'data-starting-style:-translate-y-[calc(50%-4px)] data-ending-style:-translate-y-[calc(50%-4px)]',
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <BaseDialog.Title className="text-heading font-semibold tracking-[-0.01em]">
                {title}
              </BaseDialog.Title>
              {description ? (
                <BaseDialog.Description className="text-ui-lg text-ink-muted">
                  {description}
                </BaseDialog.Description>
              ) : null}
            </div>
            <BaseDialog.Close
              render={<IconButton label={closeLabel} icon={X} size="sm" tooltip={false} />}
            />
          </div>
          {children ? <div className="overflow-y-auto">{children}</div> : null}
          {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
