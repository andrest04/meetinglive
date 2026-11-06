import { Undo2 } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Notice } from '../../ui';
import type { ApplyNotice } from './use-apply-to-summary';

/**
 * The line under the transcript after "Apply to summary" (T4). It stays until closed, the next
 * apply, or a scope change, so Undo never times out under a reader; it is a status, so a screen
 * reader hears it without losing focus. A failed Undo shows its error with Undo still offered.
 */
export function ApplySummaryNotice({
  notice,
  onUndo,
  onDismiss,
}: {
  readonly notice: ApplyNotice;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
}) {
  const t = useT();
  const undoButton = (
    <Button
      size="sm"
      variant="secondary"
      icon={Undo2}
      data-testid="BtnMeetingChatSummaryUndo"
      onClick={onUndo}
    >
      {t('Ui_ChatSummaryUndo')}
    </Button>
  );
  if (notice.kind === 'applied' && notice.undoError !== undefined) {
    return (
      <Notice
        tone="error"
        testId="InfoMeetingChatSummaryError"
        onDismiss={onDismiss}
        dismissLabel={t('Ui_Close')}
      >
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p>{notice.undoError}</p>
          {undoButton}
        </div>
      </Notice>
    );
  }
  if (notice.kind === 'error') {
    return (
      <Notice
        tone="error"
        testId="InfoMeetingChatSummaryError"
        onDismiss={onDismiss}
        dismissLabel={t('Ui_Close')}
      >
        <p>{notice.message}</p>
      </Notice>
    );
  }
  return (
    <Notice testId="InfoMeetingChatSummary" onDismiss={onDismiss} dismissLabel={t('Ui_Close')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p>{t(notice.kind === 'applied' ? 'Ui_ChatSummaryUpdated' : 'Ui_ChatSummaryRestored')}</p>
        {notice.kind === 'applied' ? undoButton : null}
      </div>
    </Notice>
  );
}
