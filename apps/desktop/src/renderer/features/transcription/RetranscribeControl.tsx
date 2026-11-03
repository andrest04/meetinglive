import { canRetranscribe } from '@vozella/core';
import type { RetranscriptionResultDto } from '@vozella/contracts';
import { AudioLines } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Button, Dialog, Notice, Progress } from '../../ui';
import type { RetranscriptionModel } from './use-retranscription';

/** The words for how a run ended (spec 2.5), or null when there is nothing to say. */
function resultMessage(
  result: RetranscriptionResultDto,
  t: (key: StringKey, ...args: (string | number)[]) => string,
): { readonly title: StringKey; readonly text: string } {
  switch (result.outcome) {
    case 'Completed':
      return { title: 'SessionPage_RetranscribeNotice.Title', text: t('SessionRetranscribe_Done') };
    case 'TranscriptOnly':
      return {
        title: 'SessionPage_RetranscribeNotice.Title',
        text: t('SessionRetranscribe_DoneNoSummary'),
      };
    case 'Cancelled':
      return {
        title: 'SessionPage_RetranscribeNotice.Title',
        text: t('SessionRetranscribe_Cancelled'),
      };
    case 'SummaryFailed':
      return {
        title: 'SessionPage_RetranscribeError.Title',
        text: t('Status_TranscriptSavedSummaryFailed', result.message ?? ''),
      };
    case 'Failed':
      return { title: 'SessionPage_RetranscribeError.Title', text: result.message ?? '' };
  }
}

/**
 * The Re-transcribe button of the session header (spec 2.7): drawn only when the meeting has saved
 * audio, enabled only when `canRetranscribe` says so, with a line that says why when it is greyed
 * (B16). A click asks again before the confirmation, and the confirmation names the meeting.
 */
export function RetranscribeButton({
  model,
  meetingTitle,
  hasAudio,
}: {
  readonly model: RetranscriptionModel;
  readonly meetingTitle: string;
  readonly hasAudio: boolean;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { running, availability, engineReady } = model;

  useEffect(() => {
    if (running) setConfirming(false);
  }, [running]);

  if (!hasAudio) return null;

  const busy = running || availability === 'Busy';
  const enabled = canRetranscribe(
    { hasMeeting: true, hasAudio: availability !== 'NoAudio' },
    busy ? 'run' : null,
  );
  const hint = busy
    ? running
      ? null
      : t('Ui_RetranscribeBusy')
    : !engineReady
      ? t('Ui_RetranscribeNeedsEngine')
      : null;

  return (
    <>
      <Button
        data-testid="BtnSessionRetranscribe"
        size="sm"
        icon={AudioLines}
        disabled={!enabled}
        aria-label={t('SessionPage_Retranscribe.AutomationProperties.Name')}
        title={t('SessionPage_Retranscribe.ToolTipService.ToolTip')}
        onClick={() => {
          // Item 96: the answer on screen may be old.
          void model.recheck().then((ok) => {
            if (ok) setConfirming(true);
          });
        }}
      >
        {t('SessionRetranscribe_Primary')}
      </Button>
      {hint ? (
        <span data-testid="TextSessionRetranscribeHint" className="text-ui text-ink-muted">
          {hint}
        </span>
      ) : null}
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('SessionRetranscribe_Title')}
        description={t('SessionRetranscribe_Content', meetingTitle)}
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
    </>
  );
}

/**
 * The rows under the header (spec 2.8): progress with Cancel while this meeting is the one running,
 * and the bar that tells how the last run ended. Bars stay until dismissed or the next run starts.
 */
export function RetranscribeStatus({ model }: { readonly model: RetranscriptionModel }) {
  const t = useT();
  const { running, status, result } = model;
  const message = result ? resultMessage(result, t) : null;
  const failed = result?.outcome === 'Failed' || result?.outcome === 'SummaryFailed';

  return (
    <>
      {running ? (
        <div
          className="flex items-center gap-4 rounded-control border border-hairline px-3 py-2.5"
          data-testid="retranscribe"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p
              id="TextSessionRetranscribeStatus"
              data-testid="TextSessionRetranscribeStatus"
              role="status"
              aria-live="polite"
              className="text-ui-lg text-ink"
            >
              {status || t('Status_Transcribing')}
            </p>
            <Progress
              testId="ProgressSessionRetranscribe"
              value={null}
              hideLabel
              label={t('SessionPage_RetranscribeProgress.AutomationProperties.Name')}
            />
          </div>
          <Button
            data-testid="BtnSessionRetranscribeCancel"
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
          testId={failed ? 'InfoSessionRetranscribeError' : 'InfoSessionRetranscribeNotice'}
          tone={failed ? 'warning' : 'info'}
          onDismiss={model.dismissResult}
          dismissLabel={t('Ui_Close')}
        >
          <span className="block font-medium">{t(message.title)}</span>
          <span className="block text-ink-muted">{message.text}</span>
        </Notice>
      ) : null}
    </>
  );
}
