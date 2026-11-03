import type { RetranscriptionResultDto } from '@vozella/contracts';
import { AudioLines } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Button, Dialog, Notice, Progress } from '../../ui';
import { percentFromStatus } from './live-lines';
import { useRetranscription } from './use-retranscription';

/** The words for how a run ended (spec 2.5), or null when there is nothing to say. */
function resultMessage(
  result: RetranscriptionResultDto,
  t: (key: StringKey, ...args: (string | number)[]) => string,
): { readonly title: StringKey | null; readonly text: string } {
  switch (result.outcome) {
    case 'Completed':
      return { title: null, text: t('SessionRetranscribe_Done') };
    case 'TranscriptOnly':
      return { title: null, text: t('SessionRetranscribe_DoneNoSummary') };
    case 'Cancelled':
      return { title: null, text: t('SessionRetranscribe_Cancelled') };
    case 'SummaryFailed':
      return {
        title: 'SessionPage_RetranscribeNotice.Title',
        text: t('Status_TranscriptSavedSummaryFailed', result.message ?? ''),
      };
    case 'Failed':
      return { title: 'SessionPage_RetranscribeError.Title', text: result.message ?? '' };
  }
}

/**
 * Re-transcribe a saved meeting (spec 2.5): a button that is available only when the meeting has
 * audio and nothing else is running, a confirmation that names the meeting, a progress line with
 * Cancel, and a notice with the outcome. The Session page places it; the run itself is in main.
 */
export function RetranscribeControl({
  meetingId,
  meetingTitle,
  onFinished,
}: {
  meetingId: string;
  meetingTitle: string;
  /** Called after a run has ended, so the page can reload the transcript and summary. */
  onFinished?: (result: RetranscriptionResultDto) => void;
}) {
  const t = useT();
  const model = useRetranscription(meetingId, onFinished);
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // A result is shown until the next run starts or the reader dismisses it.
  const { running, status, result, availability, engineReady } = model;
  useEffect(() => {
    if (running) setConfirming(false);
  }, [running]);

  const percent = percentFromStatus(status);
  const unavailable = !running && availability !== 'Available';
  const hint = unavailable
    ? availability === 'NoAudio'
      ? t('Ui_RetranscribeNoAudio')
      : t('Ui_RetranscribeBusy')
    : !engineReady && !running
      ? t('Ui_RetranscribeNeedsEngine')
      : null;
  const message = result ? resultMessage(result, t) : null;

  return (
    <div className="flex flex-col gap-3" data-testid="retranscribe">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          icon={AudioLines}
          disabled={running || availability !== 'Available'}
          aria-label={t('SessionPage_Retranscribe.AutomationProperties.Name')}
          title={t('SessionPage_Retranscribe.ToolTipService.ToolTip')}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {t('SessionRetranscribe_Primary')}
        </Button>
        {hint ? <span className="text-ui-lg text-ink-muted">{hint}</span> : null}
      </div>

      {running ? (
        <div
          className="flex max-w-md items-end gap-4"
          role="status"
          aria-label={t('Ui_RetranscribeStatusName')}
        >
          <Progress
            className="flex-1"
            label={status || t('Status_Transcribing')}
            value={percent}
            showValue={percent !== null}
          />
          <Button
            size="sm"
            aria-label={t('SessionPage_RetranscribeCancel.AutomationProperties.Name')}
            onClick={model.cancel}
          >
            {t('SessionPage_RetranscribeCancel.Content')}
          </Button>
        </div>
      ) : null}

      {!running && message ? (
        <Notice
          tone={
            result?.outcome === 'Failed' || result?.outcome === 'SummaryFailed' ? 'warning' : 'info'
          }
          onDismiss={model.dismissResult}
          dismissLabel={t('Ui_Close')}
        >
          {message.title ? <span className="block font-medium">{t(message.title)}</span> : null}
          <span className={message.title ? 'block text-ink-muted' : undefined}>{message.text}</span>
        </Notice>
      ) : null}

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('SessionRetranscribe_Title')}
        description={t('Ui_RetranscribeConfirm', meetingTitle)}
        closeLabel={t('Ui_Close')}
        initialFocus={cancelRef}
        actions={
          <>
            <Button
              ref={cancelRef}
              onClick={() => {
                setConfirming(false);
              }}
            >
              {t('SessionRetranscribe_Cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false);
                model.start();
              }}
            >
              {t('SessionRetranscribe_Primary')}
            </Button>
          </>
        }
      />
    </div>
  );
}
