import type { RecordingSetupDto } from '@vozella/contracts';
import { useT } from '../../i18n/I18nProvider';
import { Button } from '../../ui';
import { SetupCards } from './SetupCards';

/**
 * The inline setup panel (spec 2.4a): shown instead of the Record button while the page is idle
 * and something is missing. It never installs anything by itself; the button starts the same
 * ensure-ready pass Record uses.
 */
export function SetupChecklist({
  setup,
  busy,
  onSetUp,
}: {
  readonly setup: RecordingSetupDto;
  readonly busy: boolean;
  readonly onSetUp: () => void;
}) {
  const t = useT();
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="record-setup-headline"
      data-testid="setup-checklist"
    >
      <p id="record-setup-headline" className="text-read text-ink">
        {t('RecordingSetup_Headline.Text')}
      </p>
      <SetupCards setup={setup} />
      <div className="flex justify-end">
        <Button variant="primary" disabled={busy} onClick={onSetUp} data-testid="BtnSetUpToRecord">
          {t('RecordingSetup_SetUpToRecord.Content')}
        </Button>
      </div>
    </section>
  );
}
