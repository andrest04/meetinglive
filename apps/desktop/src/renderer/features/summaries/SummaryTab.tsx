import { useCallback, useMemo } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { formatMeetingDate } from '../library/format';
import { SummaryTabView, type SummaryTabLabels } from './SummaryTabView';
import { useSummaryTab } from './use-summary-tab';

/**
 * Container of the Summary tab: talks to main through `summaries.*` and the workspace, and hands
 * plain props to the view. With no id it shows the workspace's meeting, else the latest one.
 */
export function SummaryTab({ meetingId }: { readonly meetingId: string | null }) {
  const { t, locale } = useI18n();
  const model = useSummaryTab(meetingId, (detail) => t('Error_SaveActionItem', detail));
  const { state } = model;

  const labels = useMemo<SummaryTabLabels>(
    () => ({
      modeBar: t('SessionPage_TabSummary.Text'),
      myNotes: t('NotesMode_MyNotes.Text'),
      enhanced: t('NotesMode_Enhanced.Text'),
      notesHeader: t('SummaryPage_Notes.Header'),
      notesPlaceholder: t('SummaryPage_Notes.PlaceholderText'),
      empty: t('SummaryPage_Empty.Text'),
      emptyCta: t('SummaryPage_EmptyCta.Content'),
      actionItems: t('SummaryPage_ActionItems.Text'),
      related: t('SummaryPage_RelatedMeetings.Text'),
      loading: t('Ui_Loading'),
      dismiss: t('Ui_Close'),
    }),
    [t],
  );

  const related = useMemo(
    () =>
      (state?.related ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        dateLabel: formatMeetingDate(item.recordedAt, locale),
      })),
    [state, locale],
  );

  const onOpenRelated = useCallback(
    (id: string) => {
      model.flushNotes();
      void (async () => {
        await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'selectMeeting', id },
        });
        await window.vozella.invoke('workspace.dispatch', {
          action: { type: 'openSession', tab: 'Summary' },
        });
      })();
    },
    [model],
  );

  const onRecord = useCallback(() => {
    void window.vozella.invoke('workspace.dispatch', {
      action: { type: 'navigateTo', tag: 'Recording' },
    });
  }, []);

  return (
    <SummaryTabView
      labels={labels}
      loading={model.loading}
      loadError={model.loadError}
      hasMeeting={state?.hasMeeting ?? false}
      mode={model.mode}
      onModeChange={model.setMode}
      notes={model.notes}
      onNotesChange={model.setNotes}
      onNotesBlur={model.flushNotes}
      summary={state?.summary ?? ''}
      hasSummary={state?.flags.hasSummary ?? false}
      isEmpty={state?.flags.isEmpty ?? true}
      actionItems={model.actionItems}
      onToggleAction={model.toggleAction}
      related={related}
      onOpenRelated={onOpenRelated}
      onRecord={onRecord}
      status={model.status}
      onDismissStatus={model.dismissStatus}
    />
  );
}
