import { CircleCheck } from 'lucide-react';

import { useT } from '../../i18n/I18nProvider';
import { Button, Icon } from '../../ui';

/**
 * The card after a take is saved (spec 2.13): a check, the title and Open. A quiet ink edge marks
 * it; the accent colour of the WinUI card is not used because only live recording is red.
 */
export function ResultCard({
  title,
  onOpen,
}: {
  readonly title: string;
  readonly onOpen: () => void;
}) {
  const t = useT();
  return (
    <section
      className="flex items-center gap-3 rounded-control border border-s-[3px] border-hairline border-s-ink bg-paper-raised py-3 ps-3 pe-3"
      aria-label={title}
      data-testid="result-card"
    >
      <Icon icon={CircleCheck} className="shrink-0" />
      <p className="min-w-0 flex-1 truncate text-ui-lg font-medium text-ink" title={title}>
        {title}
      </p>
      <Button variant="primary" onClick={onOpen} data-testid="BtnOpenResult">
        {t('RecordPage_Open.Content')}
      </Button>
    </section>
  );
}
