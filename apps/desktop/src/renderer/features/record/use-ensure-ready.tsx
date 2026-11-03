import type { RecordingSetupDto } from '@vozella/contracts';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ProviderGateDialogs } from '../summaries/ProviderGateDialogs';
import { SetupWizardDialog } from '../summaries/SetupWizardDialog';
import { useProviderGate } from '../summaries/use-provider-gate';
import { EngineSetupDialog } from '../transcription/EngineSetupDialog';
import { SetupDialog } from './SetupDialog';
import { refreshSetup, setNotice } from './use-recording';

type Pending = (value: never) => void;

export interface EnsureReady {
  /** True when the take or import may begin; false when the user stopped the setup. */
  readonly ensureReady: () => Promise<boolean>;
  /** Mount once on the page: the checklist dialog and the three step dialogs. */
  readonly dialogs: ReactNode;
}

/**
 * EnsureReady (spec 2.4, items 14 to 17): ready returns at once; otherwise the checklist dialog
 * asks, "Set up" runs the missing steps in order (engine, then the summary chooser, then the CLI
 * for a chosen CLI engine), and the snapshot is read again until it can record. A step the user
 * cancels ends that pass and shows the checklist again; Cancel on the checklist ends the loop.
 */
export function useEnsureReady(): EnsureReady {
  const gate = useProviderGate();
  const [checklist, setChecklist] = useState<RecordingSetupDto | null>(null);
  const [engineOpen, setEngineOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const waiting = useRef<{ checklist?: Pending; engine?: Pending; wizard?: Pending }>({});

  const ask = useCallback(
    <T,>(slot: 'checklist' | 'engine' | 'wizard', open: () => void): Promise<T> =>
      new Promise<T>((resolve) => {
        waiting.current[slot] = resolve;
        open();
      }),
    [],
  );
  const answer = useCallback((slot: 'checklist' | 'engine' | 'wizard', value: unknown): void => {
    const resolve = waiting.current[slot];
    waiting.current[slot] = undefined;
    resolve?.(value as never);
  }, []);

  const runMissingSteps = useCallback(
    async (first: RecordingSetupDto): Promise<void> => {
      let setup = first;
      if (!setup.engine.ready) {
        const ready = await ask<boolean>('engine', () => {
          setEngineOpen(true);
        });
        if (!ready) return;
        setup = (await refreshSetup()) ?? setup;
      }
      if (!setup.summary.ready) {
        const chosen = await ask<boolean>('wizard', () => {
          setWizardOpen(true);
        });
        if (!chosen) return;
        setup = (await refreshSetup()) ?? setup;
        const kind = setup.provider;
        if (!setup.summary.ready && (kind === 'ClaudeCode' || kind === 'Codex')) {
          await gate.runSetup({ kind, reason: 'cli-missing' });
        }
      }
    },
    [ask, gate],
  );

  const ensureReady = useCallback(async (): Promise<boolean> => {
    let setup = await refreshSetup();
    // Main cannot say: let Start ask, because main gates it again and answers `not-ready`.
    if (setup === null) return true;
    while (!setup.canRecord) {
      const choice = await ask<'setup' | 'cancel'>('checklist', () => {
        setChecklist(setup);
      });
      setChecklist(null);
      if (choice === 'cancel') {
        setNotice({ key: 'Status_SetupCancelled', args: [], severity: 'info' });
        return false;
      }
      await runMissingSteps(setup);
      setup = (await refreshSetup()) ?? setup;
    }
    return true;
  }, [ask, runMissingSteps]);

  const dialogs = (
    <>
      <SetupDialog
        setup={checklist}
        onAnswer={(choice) => {
          answer('checklist', choice);
        }}
      />
      <EngineSetupDialog
        open={engineOpen}
        onFinished={(ready) => {
          setEngineOpen(false);
          answer('engine', ready);
        }}
      />
      <SetupWizardDialog
        open={wizardOpen}
        mode="choose"
        onFinished={(result) => {
          setWizardOpen(false);
          answer('wizard', result !== null);
        }}
      />
      <ProviderGateDialogs gate={gate} />
    </>
  );
  return { ensureReady, dialogs };
}
