import type { GenerateOutcomeDto, SummaryTabStateDto } from '@vozella/contracts';
import { deriveTabFlags, type TabFlags } from '@vozella/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StringKey, Translate } from '../../i18n/translate';
import type { Option } from '../../ui';
import type { RunSetup } from './use-provider-gate';
import type { NotesMode } from './summary-tab-model';

export type { RunSetup, SetupRequest } from './use-provider-gate';

export interface GenerationStatus {
  readonly text: string;
  readonly tone: 'info' | 'error';
}

export interface DraftMessageState {
  readonly kind: 'success' | 'error';
  readonly text: string;
}

/** A success message goes away by itself after this long (B16). */
export const DRAFT_SUCCESS_MS = 4000;

export interface SummaryGeneration {
  readonly flags: TabFlags;
  readonly generating: boolean;
  readonly status: GenerationStatus | null;
  readonly draft: DraftMessageState | null;
  readonly templateOptions: readonly Option[];
  readonly templateId: string;
  readonly setTemplateId: (id: string) => void;
  readonly generate: () => void;
  /** Opens the confirmation; the run starts only from `confirmRegenerate`. */
  readonly askRegenerate: () => void;
  readonly regenerateOpen: boolean;
  readonly closeRegenerate: () => void;
  readonly confirmRegenerate: () => void;
  readonly cancel: () => void;
  readonly copyActions: () => void;
}

export interface UseSummaryGenerationInput {
  readonly state: SummaryTabStateDto | null;
  readonly mode: NotesMode;
  readonly loading: boolean;
  readonly runningAtLoad: boolean;
  readonly settleNotes: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly t: Translate;
  /** Opens the engine or CLI setup. Without one, a run that needs setup ends as cancelled. */
  readonly runSetup?: RunSetup;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The one status line a finished run leaves behind (item 93, B28, B34). */
export function describeOutcome(outcome: GenerateOutcomeDto, t: Translate): GenerationStatus {
  switch (outcome.status) {
    case 'generated':
      return { text: t('Status_SummaryGenerated'), tone: 'info' };
    case 'cancelled':
      return { text: t('Ui_SummaryCancelled'), tone: 'info' };
    case 'failed':
      return { text: t('Error_GenerateSummary', outcome.message), tone: 'error' };
    case 'no-transcript':
      return { text: t('Error_GenerateSummary', t('Error_NoTranscript')), tone: 'error' };
    case 'not-found':
      return { text: t('Ui_SummaryMeetingGone'), tone: 'error' };
    case 'busy':
      return { text: t('Ui_SummaryMeetingBusy'), tone: 'error' };
    case 'unavailable':
      return { text: t('Ui_SummaryProviderXaiRemoved'), tone: 'error' };
    case 'needs-setup':
      return { text: t('Status_SetupCancelled'), tone: 'info' };
  }
}

/**
 * Generate, regenerate, cancel, the template pick and the copy of action items for the open
 * meeting. Main owns the run (one per meeting); this hook shows it and never writes the picked
 * template back on its own: the pick travels with the generate request (item 105).
 */
export function useSummaryGeneration(input: UseSummaryGenerationInput): SummaryGeneration {
  const { state, mode, loading, runningAtLoad, t } = input;
  const meetingId = state?.meetingId ?? null;

  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [draft, setDraft] = useState<DraftMessageState | null>(null);
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [templateId, setTemplateId] = useState('auto');

  const idRef = useRef<string | null>(null);
  idRef.current = meetingId;
  // True from the click until the answer, so a progress event for our own run is not a second run.
  const mineRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const latest = useRef(input);
  latest.current = input;
  const templateRef = useRef(templateId);
  templateRef.current = templateId;

  const flags = useMemo(
    () =>
      deriveTabFlags({
        hasMeeting: state?.hasMeeting ?? false,
        summary: state?.summary ?? null,
        transcript: state?.hasTranscript === true ? 'transcript' : null,
        isShowingNotes: mode === 'notes',
        isLoading: loading,
        isGenerating: generating,
      }),
    [state, mode, loading, generating],
  );

  const templateOptions = useMemo<readonly Option[]>(
    () =>
      (state?.templates ?? []).map((option) => ({
        value: option.id,
        label:
          option.labelKey === null ? (option.name ?? option.id) : t(option.labelKey as StringKey),
      })),
    [state?.templates, t],
  );

  // After a load the picker shows the record's template; a dropped or unknown id reads as Auto.
  // This only sets local state: nothing is sent to main (item 105). A reload that changes
  // neither the meeting nor its stored template leaves the user's pick alone.
  const storedTemplate = state?.noteTemplateId ?? 'auto';
  const templateKey = (state?.templates ?? []).map((option) => option.id).join('|');
  useEffect(() => {
    const known = templateKey.split('|').includes(storedTemplate);
    setTemplateId(known ? storedTemplate : 'auto');
  }, [meetingId, storedTemplate, templateKey]);

  // A new meeting starts with no messages.
  useEffect(() => {
    setStatus(null);
    setDraft(null);
    setRegenerateOpen(false);
  }, [meetingId]);

  // A run that started before this page opened, or somewhere else, shows here too. Main's answer
  // to a load is the truth, not the direction of an event: events and replies can cross.
  const externalRef = useRef(false);
  useEffect(() => {
    if (mineRef.current) return;
    setGenerating(runningAtLoad);
    if (runningAtLoad) {
      externalRef.current = true;
      setStatus({ text: t('Status_GeneratingSummary'), tone: 'info' });
    } else if (externalRef.current) {
      // The run we were showing is over; a finished run of our own keeps its status line.
      externalRef.current = false;
      setStatus(null);
    }
  }, [runningAtLoad, state, t]);

  useEffect(
    () =>
      window.vozella.on('summaries.progress', (event) => {
        if (event.meetingId !== idRef.current || mineRef.current) return;
        void latest.current.refresh();
      }),
    [],
  );

  useEffect(() => {
    if (draft?.kind !== 'success') return undefined;
    const timer = setTimeout(() => {
      setDraft(null);
    }, DRAFT_SUCCESS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft]);

  const run = useCallback(async (regenerate: boolean): Promise<void> => {
    const id = idRef.current;
    if (id === null || mineRef.current) return;
    const { t: tr, settleNotes, refresh, runSetup } = latest.current;
    mineRef.current = true;
    cancelRequestedRef.current = false;
    setGenerating(true);
    setDraft(null);
    setStatus({ text: tr('Status_GeneratingSummary'), tone: 'info' });
    let final: GenerationStatus | null;
    try {
      await settleNotes();
      let askedSetup = false;
      for (;;) {
        // Cancel pressed before the request reached main has nothing to stop there yet.
        if (cancelRequestedRef.current as boolean) {
          final = describeOutcome({ status: 'cancelled' }, tr);
          break;
        }
        const outcome = await window.vozella.invoke('summaries.generate', {
          meetingId: id,
          regenerate,
          templateId: templateRef.current,
        });
        if (outcome.status === 'needs-setup' && !askedSetup && runSetup) {
          askedSetup = true;
          const result = await runSetup({ kind: outcome.kind, reason: outcome.reason });
          // Cancelling the dialogs says so. A download that failed already showed its own
          // error inside the dialog, so this line is not used for it (B34).
          if (result === 'completed') continue;
          final = { text: tr('Status_SetupCancelled'), tone: 'info' };
          break;
        }
        if (outcome.status === 'unavailable' && runSetup) {
          // The gate shows a notice that points at Settings; the status line would repeat it.
          void runSetup({ kind: 'Xai', reason: 'unavailable' });
          final = null;
          break;
        }
        final = describeOutcome(outcome, tr);
        if (outcome.status === 'generated') await refresh();
        break;
      }
    } catch (error) {
      final = { text: tr('Error_GenerateSummary', errorText(error)), tone: 'error' };
    } finally {
      mineRef.current = false;
    }
    if (idRef.current !== id) return;
    setGenerating(false);
    setStatus(final);
  }, []);

  const generate = useCallback(() => {
    void run(false);
  }, [run]);

  const askRegenerate = useCallback(() => {
    setRegenerateOpen(true);
  }, []);
  const closeRegenerate = useCallback(() => {
    setRegenerateOpen(false);
  }, []);
  const confirmRegenerate = useCallback(() => {
    setRegenerateOpen(false);
    void run(true);
  }, [run]);

  const cancel = useCallback(() => {
    const id = idRef.current;
    if (id === null) return;
    if (mineRef.current) cancelRequestedRef.current = true;
    void window.vozella.invoke('summaries.cancel', { meetingId: id }).catch(() => undefined);
  }, []);

  const copyActions = useCallback(() => {
    const id = idRef.current;
    if (id === null) return;
    const tr = latest.current.t;
    setDraft(null);
    void (async () => {
      let next: DraftMessageState;
      try {
        const answer = await window.vozella.invoke('summaries.copyActions', { meetingId: id });
        if (answer.status === 'empty') {
          next = { kind: 'error', text: answer.message };
        } else if (answer.status === 'not-found') {
          next = { kind: 'error', text: tr('Ui_SummaryMeetingGone') };
        } else {
          const written = await window.vozella.invoke('summaries.writeClipboard', {
            text: answer.text,
          });
          next =
            written.status === 'written'
              ? { kind: 'success', text: tr('SummaryPage_ActionsCopied') }
              : { kind: 'error', text: tr('Ui_SummaryCopyFailed', written.detail) };
        }
      } catch (error) {
        next = { kind: 'error', text: tr('Ui_SummaryCopyFailed', errorText(error)) };
      }
      if (idRef.current === id) setDraft(next);
    })();
  }, []);

  return {
    flags,
    generating,
    status,
    draft,
    templateOptions,
    templateId,
    setTemplateId,
    generate,
    askRegenerate,
    regenerateOpen,
    closeRegenerate,
    confirmRegenerate,
    cancel,
    copyActions,
  };
}
