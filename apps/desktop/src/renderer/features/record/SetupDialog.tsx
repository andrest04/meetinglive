import type { RecordingSetupDto } from '@vozella/contracts';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog } from '../../ui';
import { SetupCards } from './SetupCards';

/**
 * The modal of the same checklist (spec 2.4b), opened by Record or Import when something is
 * missing. "Set up" runs the missing steps; "Cancel", Escape and the close button all decline. The
 * "Done" state of the WinUI dialog is never reachable there (B-17), so it is not drawn.
 */
export function SetupDialog({
  setup,
  onAnswer,
}: {
  /** Null keeps the dialog closed. */
  readonly setup: RecordingSetupDto | null;
  readonly onAnswer: (answer: 'setup' | 'cancel') => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={setup !== null}
      onOpenChange={(open) => {
        if (!open) onAnswer('cancel');
      }}
      title={t('RecordingSetup.Title')}
      description={t('RecordingSetup_Headline.Text')}
      closeLabel={t('Ui_Close')}
      actions={
        <>
          <Button
            onClick={() => {
              onAnswer('cancel');
            }}
          >
            {t('RecordingSetup.CloseButtonText')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onAnswer('setup');
            }}
          >
            {t('RecordingSetup_SetUp')}
          </Button>
        </>
      }
    >
      {setup ? <SetupCards setup={setup} /> : null}
    </Dialog>
  );
}
