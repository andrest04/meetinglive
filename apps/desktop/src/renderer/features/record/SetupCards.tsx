import type { RecordingSetupDto } from '@vozella/contracts';
import { Check } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Icon, Notice } from '../../ui';

type Card = RecordingSetupDto['live'];

/**
 * Main sends the WinUI keys, whose values name the engines and come from the generated catalogs.
 * The rows name what each step does instead, so those keys read from the hand-written ones here.
 */
const ROW_COPY: Readonly<Partial<Record<string, StringKey>>> = {
  'RecordingSetup_Live.Header': 'Ui_SetupLiveCaptions',
  'RecordingSetup_Engine.Header': 'Ui_SetupTranscript',
  RecordingSetup_LiveNotNeededDetail: 'Ui_SetupLiveCaptionsOff',
};

const rowKey = (key: string): StringKey => ROW_COPY[key] ?? (key as StringKey);

function SetupCard({ card }: { readonly card: Card }) {
  const t = useT();
  const status = t(card.status.key as StringKey, ...card.status.args);
  return (
    <li
      className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-baseline gap-x-4 py-2.5"
      data-testid="setup-card"
    >
      <p className="text-ui-lg font-medium text-ink">{t(rowKey(card.headerKey))}</p>
      <p className="text-ui text-ink-muted">{t(rowKey(card.detail.key), ...card.detail.args)}</p>
      <span className="inline-flex items-baseline gap-1.5 text-ui text-ink-muted">
        {card.ready ? <Icon icon={Check} size={14} className="self-center text-ink" /> : null}
        {status}
      </span>
    </li>
  );
}

/**
 * The three setup cards (spec 2.4): live preview, transcript engine, summary. Read only; the
 * status words and the details come from main as catalog keys, so a language change relabels them.
 */
export function SetupCards({ setup }: { readonly setup: RecordingSetupDto }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <ul
        className="flex flex-col divide-y divide-hairline border-t border-hairline"
        data-testid="setup-cards"
      >
        <SetupCard card={setup.live} />
        <SetupCard card={setup.engine} />
        <SetupCard card={setup.summary} />
      </ul>
      {setup.summaryProviderRemoved ? (
        <Notice tone="warning">
          <p data-testid="TxtProviderUnavailable">{t('Ui_SummaryProviderXaiRemoved')}</p>
        </Notice>
      ) : null}
    </div>
  );
}
