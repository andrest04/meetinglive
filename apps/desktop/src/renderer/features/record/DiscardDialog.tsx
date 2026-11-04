import { useRef } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog } from '../../ui';

/**
 * The confirmation before a take is thrown away (item 71). The default and the focus are on
 * Keep recording; only Discard runs the command. Escape and the close button keep the take.
 */
export function DiscardDialog({
  open,
  onKeep,
  onDiscard,
}: {
  readonly open: boolean;
  readonly onKeep: () => void;
  readonly onDiscard: () => void;
}) {
  const t = useT();
  const keep = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeep();
      }}
      title={t('RecordDiscard_Title')}
      description={t('RecordDiscard_Content')}
      closeLabel={t('Ui_Close')}
      initialFocus={keep}
      actions={
        <>
          <Button ref={keep} data-testid="BtnKeepRecording" onClick={onKeep}>
            {t('RecordDiscard_Cancel')}
          </Button>
          <Button variant="primary" data-testid="BtnConfirmDiscard" onClick={onDiscard}>
            {t('RecordDiscard_Primary')}
          </Button>
        </>
      }
    />
  );
}
