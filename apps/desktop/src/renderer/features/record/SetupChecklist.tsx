import type { RecordingSetupDto } from '@vozella/contracts';
import { useT } from '../../i18n/I18nProvider';
import { SetupCards } from './SetupCards';

/**
 * The inline setup panel (spec 2.4a): shown while the page is idle and something is missing. It
 * never installs anything by itself; the page's action row holds the button that starts the same
 * ensure-ready pass Record uses.
 */
export function SetupChecklist({ setup }: { readonly setup: RecordingSetupDto }) {
  const t = useT();
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="record-setup-headline"
      data-testid="setup-checklist"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="record-setup-headline" className="text-ui-lg font-semibold text-ink">
          {t('Ui_SetupHeading')}
        </h2>
        <p className="text-ui text-ink-muted">{t('Ui_SetupNoDownloads')}</p>
      </div>
      <SetupCards setup={setup} />
    </section>
  );
}
