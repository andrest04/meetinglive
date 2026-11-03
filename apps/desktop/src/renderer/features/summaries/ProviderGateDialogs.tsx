import { useT } from '../../i18n/I18nProvider';
import { Button, Notice } from '../../ui';
import { CliSetupDialog } from './CliSetupDialog';
import { SetupWizardDialog } from './SetupWizardDialog';
import type { ProviderGate } from './use-provider-gate';

/** The dialogs of a provider gate. Put it once on a page that passes `gate.runSetup` down. */
export function ProviderGateDialogs({ gate }: { readonly gate: ProviderGate }) {
  const { open } = gate;
  return (
    <>
      <SetupWizardDialog
        open={open?.surface === 'wizard'}
        mode="local-only"
        onFinished={(result) => {
          gate.finish(result !== null);
        }}
      />
      <CliSetupDialog
        open={open?.surface === 'cli'}
        kind={open?.surface === 'cli' ? open.kind : 'ClaudeCode'}
        onFinished={gate.finish}
      />
    </>
  );
}

/** Shown after a removed provider (Grok) was selected: pick another one in Settings. */
export function ProviderUnavailableNotice({ gate }: { readonly gate: ProviderGate }) {
  const t = useT();
  if (!gate.unavailable) return null;
  return (
    <Notice tone="warning" onDismiss={gate.dismissUnavailable} dismissLabel={t('Ui_Close')}>
      <p data-testid="TxtProviderUnavailable">{t('Ui_SummaryProviderXaiRemoved')}</p>
      <Button size="sm" className="mt-2" data-testid="BtnOpenSettings" onClick={gate.openSettings}>
        {t('Nav_Settings')}
      </Button>
    </Notice>
  );
}
