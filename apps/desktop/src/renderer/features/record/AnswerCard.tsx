import type { RecordingAnswerDto } from '@vozella/contracts';
import { useT } from '../../i18n/I18nProvider';
import { Badge } from '../../ui';

/**
 * The answer of the live ask, in the side panel (spec 2.8 item 4). It stays up after the take so
 * the user can still read and copy it; the text is plain and selectable, and scrolls past 160 px.
 */
export function AnswerCard({ answer }: { readonly answer: RecordingAnswerDto }) {
  const t = useT();
  if (answer.text === '') return null;
  return (
    <section
      className="flex flex-col gap-1.5"
      aria-labelledby="live-answer-heading"
      data-testid="answer-card"
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h2 id="live-answer-heading" className="text-ui font-medium text-ink">
          {t('RecordPage_LiveAnswerHeading.Text')}
        </h2>
        {answer.usedWeb ? <Badge tone="outline">{t('Ui_SearchedWeb')}</Badge> : null}
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label={t('RecordPage_LiveAnswerText.AutomationProperties.Name')}
        className="max-h-[160px] overflow-y-auto rounded-control border border-hairline bg-paper-raised px-3 py-2 text-read leading-6 whitespace-pre-wrap text-ink select-text"
        data-testid="answer-text"
      >
        {answer.text}
      </div>
    </section>
  );
}
