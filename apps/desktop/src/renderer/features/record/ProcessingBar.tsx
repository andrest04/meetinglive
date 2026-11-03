import { RotateCcw } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Progress } from '../../ui';

/**
 * The bar while a run processes (spec 2.10 and 2.11): the status in one strong line that screen
 * readers hear politely, an indeterminate bar, and Cancel. Cancel is enabled only while there is a
 * run to cancel; the take is already saved by then, so it never loses the audio.
 */
export function ProcessingBar({
  statusText,
  canCancel,
  onCancel,
}: {
  readonly statusText: string;
  readonly canCancel: boolean;
  readonly onCancel: () => void;
}) {
  const t = useT();
  return (
    <section
      className="flex flex-col gap-3 rounded-control border border-hairline bg-paper-raised p-4"
      data-testid="processing-bar"
    >
      <div className="flex items-center gap-4">
        <p
          role="status"
          aria-live="polite"
          className="min-w-0 flex-1 text-ui-lg font-medium break-words text-ink"
          data-testid="recording-status"
        >
          {statusText}
        </p>
        <Button
          disabled={!canCancel}
          aria-label={t('RecordPage_CancelProcessing.AutomationProperties.Name')}
          data-testid="BtnCancelProcessing"
          onClick={onCancel}
        >
          {t('RecordPage_CancelProcessing.Content')}
        </Button>
      </div>
      <Progress value={null} label={statusText} labelHidden />
    </section>
  );
}

/** B-11: the first save failed, the audio is kept; this runs the pipeline on it again. */
export function RetryAction({ onRetry }: { readonly onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex justify-center" data-testid="retry-action">
      <Button icon={RotateCcw} data-testid="BtnRetryProcessing" onClick={onRetry}>
        {t('Ui_RetryProcessing')}
      </Button>
    </div>
  );
}
