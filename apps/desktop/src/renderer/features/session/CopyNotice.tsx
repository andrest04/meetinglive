import { useT } from '../../i18n/I18nProvider';
import { Notice } from '../../ui';

/** The "Copied" confirmation under the header. The container closes it after 2.5 s. */
export function CopyNotice({ onDismiss }: { readonly onDismiss: () => void }) {
  const t = useT();
  return (
    <div data-testid="InfoSessionCopy">
      <Notice onDismiss={onDismiss} dismissLabel={t('Ui_Close')}>
        <span className="sr-only">{t('SessionPage_CopyConfirmation.Title')}. </span>
        {t('SessionPage_CopyConfirmation.Message')}
      </Notice>
    </div>
  );
}
