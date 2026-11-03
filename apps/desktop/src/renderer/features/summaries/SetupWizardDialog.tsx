import type { ReactNode } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Dialog, Progress } from '../../ui';
import { CliCheckPanel } from './CliCheckPanel';
import { EngineChooser } from './EngineChooser';
import { ModelPicker } from './ModelPicker';
import { useSetupWizard, type SetupWizard } from './use-setup-wizard';
import type { WizardMode, WizardResult } from './wizard-state';

/** What the CLI check panel (S19) gets: the CLI to check and the two ways out of the panel. */
export interface CliPanelContext {
  readonly kind: 'ClaudeCode' | 'Codex';
  readonly onBack: () => void;
  /** The executable was found and saved as the provider. */
  readonly onReady: () => void;
}

export interface SetupWizardDialogProps {
  readonly open: boolean;
  /** `choose` starts at the chooser; `local-only` opens straight on the hardware step (B33). */
  readonly mode: WizardMode;
  /** Called once: the engine that is ready, or null when the user leaves. */
  readonly onFinished: (result: WizardResult | null) => void;
  /** The CheckingCli panel. Defaults to `CliCheckPanel`; tests pass a stub. */
  readonly renderCliPanel?: (context: CliPanelContext) => ReactNode;
}

/**
 * "Set up summary generation" (spec 2.6): pick an engine, or pick and download a local model.
 * Cancel, Escape and the close button all leave the wizard; a running download is cancelled
 * through the shared model service and nothing is saved afterwards (B6).
 */
const defaultCliPanel = (context: CliPanelContext): ReactNode => <CliCheckPanel {...context} />;

export function SetupWizardDialog(props: SetupWizardDialogProps) {
  // The wizard is built when it opens and dropped when it closes, so every opening starts fresh.
  return props.open ? <OpenWizard {...props} /> : null;
}

function OpenWizard({ mode, onFinished, renderCliPanel }: SetupWizardDialogProps) {
  const t = useT();
  const wizard = useSetupWizard(mode, onFinished);
  const { state } = wizard;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) wizard.close();
      }}
      title={t('Setup_Title.Title')}
      closeLabel={t('Ui_Close')}
      actions={<Actions wizard={wizard} />}
    >
      <div className="flex flex-col gap-3" data-testid="summary-setup">
        {state.phase === 'ChoosingEngine' ? <EngineChooser onChoose={wizard.chooseEngine} /> : null}
        {state.phase === 'DetectingHardware' ? <Detecting wizard={wizard} /> : null}
        {state.phase === 'SelectingModel' ? (
          <ModelPicker
            hardware={state.hardware}
            rows={state.rows}
            selected={state.selected}
            error={state.error}
            disabled={state.busy}
            onSelect={wizard.select}
          />
        ) : null}
        {state.phase === 'Downloading' ? <DownloadingPanel wizard={wizard} /> : null}
        {state.phase === 'CheckingCli'
          ? (renderCliPanel ?? defaultCliPanel)({
              kind: state.cli,
              onBack: wizard.back,
              onReady: wizard.cliReady,
            })
          : null}
      </div>
    </Dialog>
  );
}

function Detecting({ wizard }: { readonly wizard: SetupWizard }) {
  const t = useT();
  const { state } = wizard;
  if (state.phase !== 'DetectingHardware') return null;
  return state.error === null ? (
    <Progress label={t('Setup_DetectingHardware.Text')} value={null} />
  ) : (
    <div className="flex flex-col items-start gap-2">
      <p className="text-ui-lg text-ink" role="status">
        {state.error}
      </p>
      <Button onClick={wizard.retryHardware}>{t('Ui_XaiRetry')}</Button>
    </div>
  );
}

function DownloadingPanel({ wizard }: { readonly wizard: SetupWizard }) {
  const t = useT();
  const { state } = wizard;
  if (state.phase !== 'Downloading') return null;
  const name =
    state.rows.find((row) => row.fileName === state.fileName)?.displayName ?? state.fileName;
  const percent = Math.round(state.percent);
  return (
    <div className="flex flex-col gap-3" data-testid="PanelDownloading">
      <Progress label={t('Ui_ModelDownloading')} value={percent} showValue />
      <p className="text-ui-lg text-ink" data-testid="TxtDownloadStatus">
        {t('Download_ModelProgress', name, percent)}
      </p>
    </div>
  );
}

/** Footer buttons. Cancel is always there; the other button belongs to the phase. */
function Actions({ wizard }: { readonly wizard: SetupWizard }) {
  const t = useT();
  const { state } = wizard;
  const cancel = (
    <Button data-testid="BtnSetupCancel" onClick={wizard.close}>
      {t('Setup_Title.CloseButtonText')}
    </Button>
  );
  if (state.phase === 'Downloading') {
    return (
      <>
        <Button data-testid="BtnCancelDownload" onClick={wizard.cancelDownload}>
          {t('Ui_ModelCancelDownload')}
        </Button>
        {cancel}
      </>
    );
  }
  if (state.phase === 'SelectingModel') {
    const selected = state.selected;
    return (
      <>
        {cancel}
        <Button
          variant="primary"
          data-testid="BtnDownloadModel"
          disabled={selected === null || state.busy}
          onClick={() => {
            if (selected !== null) wizard.chooseModel(selected);
          }}
        >
          {state.error === null ? t('Setup_DownloadModel.Content') : t('Ui_XaiRetry')}
        </Button>
      </>
    );
  }
  return cancel;
}
