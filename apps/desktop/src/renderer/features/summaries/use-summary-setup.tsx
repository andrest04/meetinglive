import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { SetupWizardDialog } from './SetupWizardDialog';
import type { RunSetup } from './use-summary-generation';

/**
 * Hosts the setup dialogs for the Summary tab. `runSetup` opens the wizard on the model step when
 * the Local engine has no model, and resolves `completed` once a model is saved or `cancelled`
 * when the user leaves. A CLI request resolves `cancelled` for now: the CLI panel is S19's.
 */
export function useSummarySetup(): { readonly runSetup: RunSetup; readonly dialog: ReactNode } {
  const [open, setOpen] = useState(false);
  const pending = useRef<((result: 'completed' | 'cancelled') => void) | null>(null);

  // A page that goes away while the dialog is open must not leave the caller waiting.
  useEffect(
    () => () => {
      pending.current?.('cancelled');
      pending.current = null;
    },
    [],
  );

  const runSetup = useCallback<RunSetup>(
    (request) =>
      request.kind === 'Local'
        ? new Promise((resolve) => {
            pending.current = resolve;
            setOpen(true);
          })
        : Promise.resolve('cancelled'),
    [],
  );

  const dialog = (
    <SetupWizardDialog
      open={open}
      mode="local-only"
      onFinished={(result) => {
        setOpen(false);
        pending.current?.(result === null ? 'cancelled' : 'completed');
        pending.current = null;
      }}
    />
  );
  return { runSetup, dialog };
}
