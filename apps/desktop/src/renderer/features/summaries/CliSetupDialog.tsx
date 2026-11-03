import type { SummaryCliKindDto } from '@vozella/contracts';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog, Notice } from '../../ui';
import { LinkedText } from './cli-hint';
import { useCliCheck } from './use-cli-check';

export interface CliSetupDialogProps {
  readonly open: boolean;
  readonly kind: SummaryCliKindDto;
  /** True when the executable was found; false when the user cancels. Called once. */
  readonly onFinished: (found: boolean) => void;
}

/**
 * "Set up the Claude Code CLI" (spec 2.7): the selected CLI is not on PATH. Retry looks again;
 * a miss keeps the dialog open with the "still not found" line (item 140).
 */
export function CliSetupDialog(props: CliSetupDialogProps) {
  return props.open ? <OpenCliSetup {...props} /> : null;
}

function OpenCliSetup({ kind, onFinished }: CliSetupDialogProps) {
  const t = useT();
  const cli = useCliCheck(
    kind,
    async (which) => (await window.vozella.invoke('summaries.checkCli', { kind: which })).found,
    () => {
      onFinished(true);
    },
    'Cli_NotFound',
  );
  const cancel = () => {
    onFinished(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
      title={t('Cli_SetupTitle', cli.name)}
      closeLabel={t('Ui_Close')}
      actions={
        <>
          <Button data-testid="BtnCliCancel" onClick={cancel}>
            {t('CliSetup.CloseButtonText')}
          </Button>
          <Button
            variant="primary"
            data-testid="BtnCliRetry"
            disabled={cli.checking}
            onClick={cli.recheck}
          >
            {t('CliSetup.PrimaryButtonText')}
          </Button>
        </>
      }
    >
      <Notice tone="warning">
        <p className="font-medium">{t('CliSetup_NotFound.Title')}</p>
        <p className="mt-1" data-testid="TxtCliMessage">
          <LinkedText text={cli.message} />
        </p>
      </Notice>
    </Dialog>
  );
}
