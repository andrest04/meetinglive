import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { useDialogs } from '../shell/dialog-service';

interface SummaryContent {
  readonly summary: string | null;
  readonly actionItems: readonly { readonly text: string; readonly isDone: boolean }[];
}

/**
 * The line under the transcript after an apply: what happened, with Undo while it can. A failed
 * Undo keeps the previous content (`undoError` says why), so Undo can be tried again.
 */
export type ApplyNotice =
  | {
      readonly kind: 'applied';
      readonly meetingId: string;
      readonly previous: SummaryContent;
      readonly undoError?: string;
    }
  | { readonly kind: 'restored' }
  | { readonly kind: 'error'; readonly message: string };

export interface ApplyToSummary {
  /** Null outside a meeting scope: no Apply button then. */
  readonly apply: ((answer: string) => Promise<void>) | null;
  readonly notice: ApplyNotice | null;
  readonly undo: () => Promise<void>;
  readonly dismiss: () => void;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * T4: "Apply to summary" on a chat answer. Asks first, then main splits the answer and replaces
 * the meeting's summary (and its action items when the answer has some). The previous content
 * comes back from main and stays here, so Undo puts it back exactly for this session.
 */
export function useApplyToSummary(meetingId: string | null): ApplyToSummary {
  const t = useT();
  const dialogs = useDialogs();
  const [notice, setNotice] = useState<ApplyNotice | null>(null);
  const busy = useRef(false);
  const latest = useRef({ t, dialogs });
  latest.current = { t, dialogs };

  // Another meeting in scope: the old Undo would act on a meeting the panel no longer shows.
  useEffect(() => {
    setNotice(null);
  }, [meetingId]);

  const failureText = useCallback((status: string, detail = ''): string => {
    const tr = latest.current.t;
    if (status === 'busy') return tr('Ui_ChatSummaryBusy');
    if (status === 'empty') return tr('Ui_ChatSummaryEmpty');
    return tr('Ui_ChatSummaryFailed', detail || status);
  }, []);
  const failure = useCallback(
    (status: string, detail = ''): ApplyNotice => ({
      kind: 'error',
      message: failureText(status, detail),
    }),
    [failureText],
  );

  const apply = useCallback(
    async (answer: string): Promise<void> => {
      if (meetingId === null || busy.current) return;
      busy.current = true;
      try {
        const tr = latest.current.t;
        const accepted = await latest.current.dialogs.confirm({
          title: tr('Ui_ChatApplySummaryTitle'),
          content: tr('Ui_ChatApplySummaryBody'),
          primaryText: tr('Ui_ChatApplySummaryConfirm'),
          closeText: tr('Ui_ChatApplySummaryCancel'),
          defaultButton: 'close',
        });
        if (!accepted) return;
        const result = await window.vozella.invoke('summaries.replaceSummary', {
          meetingId,
          source: { kind: 'answer', text: answer },
        });
        if (result.status === 'saved') {
          setNotice({ kind: 'applied', meetingId, previous: result.previous });
        } else {
          setNotice(failure(result.status, result.status === 'failed' ? result.detail : ''));
        }
      } catch (error) {
        setNotice(failure('failed', errorText(error)));
      } finally {
        busy.current = false;
      }
    },
    [meetingId, failure],
  );

  const undo = useCallback(async (): Promise<void> => {
    if (notice?.kind !== 'applied' || busy.current) return;
    busy.current = true;
    try {
      const result = await window.vozella.invoke('summaries.replaceSummary', {
        meetingId: notice.meetingId,
        source: {
          kind: 'restore',
          summary: notice.previous.summary,
          actionItems: notice.previous.actionItems.map((item) => ({ ...item })),
        },
      });
      if (result.status === 'saved') {
        setNotice({ kind: 'restored' });
      } else {
        const detail = result.status === 'failed' ? result.detail : '';
        setNotice({ ...notice, undoError: failureText(result.status, detail) });
      }
    } catch (error) {
      setNotice({ ...notice, undoError: failureText('failed', errorText(error)) });
    } finally {
      busy.current = false;
    }
  }, [notice, failureText]);

  const dismiss = useCallback(() => {
    setNotice(null);
  }, []);

  return { apply: meetingId === null ? null : apply, notice, undo, dismiss };
}
