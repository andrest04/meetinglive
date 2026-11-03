import { Mic } from 'lucide-react';
import { useT } from '../../i18n/I18nProvider';
import { SourcesPanel } from '../audio/SourcesPanel';
import { Button, Field, Input, SectionHeader, Textarea } from '../../ui';

/**
 * The recording module owns this page. Until it lands the form is not wired and the Record button
 * is inert; the Sources block is the audio-capture module's and works.
 */
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
      <SourcesPanel active />
      <div>
        <Button variant="primary" icon={Mic}>
          {t('Record_Record')}
        </Button>
      </div>
    </section>
  );
}
