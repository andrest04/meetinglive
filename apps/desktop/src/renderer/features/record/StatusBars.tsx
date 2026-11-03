import { useT } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Notice } from '../../ui';
import { hasStatusError, type StatusMessage } from './record-layout';

/** The messages of a status, translated and joined with a space (R4: one message per part). */
export function useStatusText(messages: readonly StatusMessage[]): string {
  const t = useT();
  return messages.map((message) => t(message.key as StringKey, ...message.args)).join(' ');
}

/**
 * The status of the page (spec 2.18). An error shows as the "Something went wrong" bar, in the
 * idle column and again during a session; anything milder is a quiet caption under the hero.
 */
export function StatusBars({
  messages,
  scope,
}: {
  readonly messages: readonly StatusMessage[];
  /** `idle` draws the muted caption too; `session` draws only the error bar. */
  readonly scope: 'idle' | 'session';
}) {
  const t = useT();
  const text = useStatusText(messages);
  if (text === '') return null;
  if (hasStatusError(messages)) {
    return (
      <Notice tone="error" className="w-full">
        <p className="font-medium">{t('RecordPage_StatusErrorTitle.Title')}</p>
        <p className="text-ui text-ink-muted" data-testid="status-error-text">
          {text}
        </p>
      </Notice>
    );
  }
  if (scope === 'session') return null;
  return (
    <p
      role="status"
      aria-live="polite"
      className="mx-auto max-w-[420px] text-center text-ui text-ink-muted"
      data-testid="status-text"
    >
      {text}
    </p>
  );
}
