import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Context,
  type ReactNode,
} from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog } from '../../ui';

export interface ConfirmRequest {
  readonly title: string;
  /** Text or any controls (item 135). */
  readonly content?: ReactNode;
  readonly primaryText: string;
  readonly closeText: string;
  /** Who takes the focus. Callers pick; destructive confirmations choose 'close'. Default 'close'. */
  readonly defaultButton?: 'primary' | 'close';
}

export interface ErrorRequest {
  readonly title: string;
  readonly content?: ReactNode;
  readonly closeText: string;
}

export interface DialogService {
  /** Resolves true for the primary button, false for Close, Escape or the X. */
  confirm(request: ConfirmRequest): Promise<boolean>;
  /** One Close button; resolves when it is dismissed. */
  error(request: ErrorRequest): Promise<void>;
}

type Pending =
  | {
      readonly id: number;
      readonly kind: 'confirm';
      readonly request: ConfirmRequest;
      readonly done: (accepted: boolean) => void;
    }
  | {
      readonly id: number;
      readonly kind: 'error';
      readonly request: ErrorRequest;
      readonly done: () => void;
    };

// Hot reload re-runs this module; reuse the context so consumers stay bound to the Provider.
const DialogContext: Context<DialogService | null> =
  ((import.meta.hot?.data as Record<string, unknown> | undefined)?.dialogContext as
    Context<DialogService | null> | undefined) ?? createContext<DialogService | null>(null);
if (import.meta.hot)
  (import.meta.hot.data as Record<string, unknown>).dialogContext = DialogContext;

export function useDialogs(): DialogService {
  const service = useContext(DialogContext);
  if (service === null) throw new Error('useDialogs needs a DialogHost above it');
  return service;
}

/**
 * The one construction point for content dialogs (spec 2.16, items 133 to 135). WinUI allows one
 * dialog at a time and a second one throws; here a second request waits its turn, so it never
 * throws and never stacks two modals.
 */
export function DialogHost({ children }: { readonly children: ReactNode }) {
  const t = useT();
  const [queue, setQueue] = useState<readonly Pending[]>([]);
  const nextId = useRef(0);
  const primary = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  const service = useMemo<DialogService>(
    () => ({
      confirm: (request) =>
        new Promise<boolean>((resolve) => {
          const id = nextId.current++;
          setQueue((q) => [...q, { id, kind: 'confirm', request, done: resolve }]);
        }),
      error: (request) =>
        new Promise<void>((resolve) => {
          const id = nextId.current++;
          setQueue((q) => [...q, { id, kind: 'error', request, done: resolve }]);
        }),
    }),
    [],
  );

  const current = queue[0];
  const settle = useCallback(
    (accepted: boolean) => {
      if (current === undefined) return;
      setQueue((q) => q.filter((entry) => entry.id !== current.id));
      if (current.kind === 'confirm') current.done(accepted);
      else current.done();
    },
    [current],
  );

  return (
    <DialogContext.Provider value={service}>
      {children}
      {current === undefined ? null : (
        <Dialog
          key={current.id}
          open
          onOpenChange={(open) => {
            if (!open) settle(false);
          }}
          title={current.request.title}
          closeLabel={t('Ui_Close')}
          initialFocus={
            current.kind === 'confirm' && current.request.defaultButton === 'primary'
              ? primary
              : close
          }
          actions={
            current.kind === 'confirm' ? (
              <>
                <Button
                  ref={close}
                  data-testid="DialogClose"
                  onClick={() => {
                    settle(false);
                  }}
                >
                  {current.request.closeText}
                </Button>
                <Button
                  ref={primary}
                  variant="primary"
                  data-testid="DialogPrimary"
                  onClick={() => {
                    settle(true);
                  }}
                >
                  {current.request.primaryText}
                </Button>
              </>
            ) : (
              <Button
                ref={close}
                data-testid="DialogClose"
                onClick={() => {
                  settle(false);
                }}
              >
                {current.request.closeText}
              </Button>
            )
          }
        >
          {current.request.content}
        </Dialog>
      )}
    </DialogContext.Provider>
  );
}
