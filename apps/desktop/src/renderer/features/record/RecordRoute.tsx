import { Mic } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import { Button, Field, Input, SectionHeader, Textarea } from '../../ui';

/** Placeholder for the recording module: the layout of the setup form, not yet wired. */
export function RecordRoute() {
  const t = useT();
  return (
    <section className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title={t('RecordPage_Title.Text')}
        description={t('RecordPage_Subtitle.Text')}
      />
      <div className="flex flex-col gap-5">
        <Field label={t('RecordPage_MeetingTitle.Header')}>
          <Input />
        </Field>
        <Field label={t('RecordPage_SessionNotes.Header')}>
          <Textarea rows={6} placeholder={t('RecordPage_SessionNotes.PlaceholderText')} />
        </Field>
      </div>
      <div>
        <Button variant="primary" icon={Mic}>
          {t('Record_Record')}
        </Button>
      </div>
    </section>
  );
}
