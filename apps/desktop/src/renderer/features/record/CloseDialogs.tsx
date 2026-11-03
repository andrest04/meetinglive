import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog, Progress } from '../../ui';

interface Request {
  readonly requestId: string;
  readonly dialog: 'confirm-stop' | 'saving' | 'save-failed';
}

async function answer(requestId: string, accepted: boolean): Promise<void> {
  try {
    await window.vozella.invoke('recording.closeAnswer', { requestId, accepted });
  } catch {
    // Main treats a missing answer as "stay open".
  }
}

/**
 * The dialogs of the app close flow (spec 2.16, item 165). Main decides which one shows and in
 * which order; this only draws it and sends the answer. The defaults are the safe side: Keep
 * recording while a take runs, Close anyway never receives the focus.
 */
export function CloseDialogs() {
  const t = useT();
  const [request, setRequest] = useState<Request | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const stay = useRef<HTMLButtonElement>(null);

  useEffect(
    () =>
      window.vozella.on('recording.closeRequest', ({ requestId, dialog }) => {
        // `done` ends the saving dialog; a later dialog of the same close is a new request.
        setRequest((current) =>
          dialog === 'done'
            ? current?.dialog === 'saving'
              ? null
              : current
            : { requestId, dialog },
        );
      }),
    [],
  );

  const respond = (accepted: boolean): void => {
    if (request === null) return;
    const { requestId } = request;
    setRequest(null);
    void answer(requestId, accepted);
  };

  const dialog = request?.dialog ?? null;
  return (
    <>
      <Dialog
        open={dialog === 'confirm-stop'}
        onOpenChange={(open) => {
          if (!open) respond(false);
        }}
        title={t('AppClose_Recording_Title')}
        description={t('AppClose_Recording_Content')}
        closeLabel={t('Ui_Close')}
        initialFocus={keep}
        actions={
          <>
            <Button
              ref={keep}
              data-testid="BtnKeepRecording"
              onClick={() => {
                respond(false);
              }}
            >
              {t('AppClose_Recording_Keep')}
            </Button>
            <Button
              variant="primary"
              data-testid="BtnStopAndSave"
              onClick={() => {
                respond(true);
              }}
            >
              {t('AppClose_Recording_StopAndSave')}
            </Button>
          </>
        }
      />
      <Dialog
        open={dialog === 'saving'}
        onOpenChange={() => undefined}
        dismissible={false}
        title={t('AppClose_Saving_Title')}
        closeLabel={t('Ui_Close')}
      >
        <Progress value={null} label={t('AppClose_Saving_Title')} labelHidden />
      </Dialog>
      <Dialog
        open={dialog === 'save-failed'}
        onOpenChange={(open) => {
          if (!open) respond(false);
        }}
        title={t('AppClose_SaveFailed_Title')}
        description={t('AppClose_SaveFailed_Content')}
        closeLabel={t('Ui_Close')}
        initialFocus={stay}
        actions={
          <>
            <Button
              ref={stay}
              data-testid="BtnKeepOpen"
              onClick={() => {
                respond(false);
              }}
            >
              {t('AppClose_SaveFailed_Stay')}
            </Button>
            <Button
              variant="primary"
              data-testid="BtnCloseAnyway"
              onClick={() => {
                respond(true);
              }}
            >
              {t('AppClose_SaveFailed_CloseAnyway')}
            </Button>
          </>
        }
      />
    </>
  );
}
