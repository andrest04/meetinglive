import type { RecordingSetupDto } from '@vozella/contracts';
import { Check, Circle } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Icon, Notice } from '../../ui';

type Card = RecordingSetupDto['live'];

function SetupCard({ card }: { readonly card: Card }) {
  const t = useT();
  const status = t(card.status.key as StringKey, ...card.status.args);
  return (
    <li className="flex items-start gap-3 py-2.5" data-testid="setup-card">
      <Icon
        icon={card.ready ? Check : Circle}
        className={card.ready ? 'mt-0.5 text-ink' : 'mt-0.5 text-ink-faint'}
      />
      <div className="min-w-0 flex-1">
        <p className="text-ui-lg font-medium text-ink">{t(card.headerKey as StringKey)}</p>
        <p className="text-ui text-ink-muted">
          {t(card.detail.key as StringKey, ...card.detail.args)}
        </p>
      </div>
      <span className="shrink-0 text-ui text-ink-muted">{status}</span>
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
        className="flex flex-col divide-y divide-hairline border-y border-hairline"
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
