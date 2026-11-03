import type { MeetingRecordDto } from '@vozella/contracts';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { Icon, SectionHeader, cn } from '../../ui';
import { RetranscribeControl } from '../transcription/RetranscribeControl';

/**
 * Placeholder for the session module: it shows which meeting the Library opened and on which
 * tab, so the hand-off through the workspace is real. The transcript and summary arrive with
 * that module.
 */
export function SessionRoute() {
  const t = useT();
  const [meeting, setMeeting] = useState<MeetingRecordDto | null | undefined>(undefined);
  const [tab, setTab] = useState<'Transcript' | 'Summary'>('Transcript');

  useEffect(() => {
    void (async () => {
      const state = await window.vozella.invoke('workspace.getState', {});
      setTab(state.sessionTab);
      if (state.selectedMeetingId === null) {
        setMeeting(null);
        return;
      }
      const { record } = await window.vozella.invoke('library.getMeeting', {
        id: state.selectedMeetingId,
      });
      setMeeting(record);
    })();
  }, []);

  return (
    <section className="flex flex-col gap-5">
      <button
        type="button"
        onClick={() => {
          // Pages ask the workspace to navigate; the shell is the only listener that does.
          void window.vozella.invoke('workspace.dispatch', {
            action: { type: 'navigateTo', tag: 'History' },
          });
        }}
        className={cn(
          'inline-flex h-7 w-fit items-center gap-1.5 rounded-control pe-2 ps-1.5 text-ui-lg text-ink-muted',
          'transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink',
        )}
      >
        <Icon icon={ArrowLeft} size={14} />
        {t('SessionPage_Back.AutomationProperties.Name')}
      </button>
      {meeting === undefined ? null : meeting === null ? (
        <p className="text-read text-ink-muted">{t('SessionPage_Empty.Text')}</p>
      ) : (
        <>
          <SectionHeader level={1} title={meeting.title} />
          <p className="text-ui-lg text-ink-muted">
            {tab === 'Summary'
              ? t('SessionPage_TabSummary.Text')
              : t('SessionPage_TabTranscript.Text')}
          </p>
          <RetranscribeControl meetingId={meeting.id} meetingTitle={meeting.title} />
        </>
      )}
    </section>
  );
}
