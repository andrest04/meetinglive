import { Toast as BaseToast } from '@base-ui/react/toast';
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button';
import { cn } from './cn';
import { Icon } from './Icon';
import { popupColors, popupSurface } from './styles';

export type ToastKind = 'info' | 'success' | 'error';

const glyphs: Record<ToastKind, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  error: CircleAlert,
};

function ToastList({ dismissLabel }: { dismissLabel: string }) {
  const { toasts } = BaseToast.useToastManager();
  return toasts.map((toast) => {
    const kind = (toast.type as ToastKind | undefined) ?? 'info';
    return (
      <BaseToast.Root
        key={toast.id}
        toast={toast}
        className={cn(
          popupSurface,
          popupColors,
          'flex w-full items-start gap-2.5 p-3 [transition-property:opacity,translate]',
        )}
      >
        <Icon icon={glyphs[kind]} className="mt-0.5" />
        <BaseToast.Content className="flex min-w-0 flex-1 flex-col gap-0.5">
          <BaseToast.Title className="text-ui-lg font-medium" />
          <BaseToast.Description className="text-ui text-ink-muted" />
        </BaseToast.Content>
        <BaseToast.Close
          render={<IconButton label={dismissLabel} icon={X} size="sm" tooltip={false} />}
        />
      </BaseToast.Root>
    );
  });
}

/**
 * Mount once. Notices appear bottom right, stay five seconds, and pause while hovered or focused.
 * A floating control at the bottom right sets `--launcher-clearance` on the root while it shows,
 * and the notices stack above it.
 */
export function ToastProvider({
  dismissLabel,
  children,
}: {
  dismissLabel: string;
  children: ReactNode;
}) {
  return (
    <BaseToast.Provider timeout={5000} limit={3}>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed right-4 bottom-[calc(1rem+var(--launcher-clearance,0px))] z-50 flex w-80 flex-col gap-2">
          <ToastList dismissLabel={dismissLabel} />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly kind?: ToastKind;
}

export function useToast(): { show: (options: ToastOptions) => void } {
  const manager = BaseToast.useToastManager();
  return {
    show: ({ title, description, kind = 'info' }) => {
      manager.add({ title, description, type: kind, priority: kind === 'error' ? 'high' : 'low' });
    },
  };
}
