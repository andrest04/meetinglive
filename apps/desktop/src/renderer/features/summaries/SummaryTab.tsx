import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { formatMeetingDate } from '../library/format';
import { DraftMessage } from './DraftMessage';
import { RegenerateDialog } from './RegenerateDialog';
import { SummaryActionBar, SummaryStatusLine } from './SummaryActionBar';
import { SummaryTabView, type SummaryTabLabels } from './SummaryTabView';
import { useSummaryGeneration, type RunSetup } from './use-summary-generation';
import { useSummaryTab } from './use-summary-tab';

/**
 * Container of the Summary tab: talks to main through `summaries.*` and the workspace, and hands
 * plain props to the view. With no id it shows the workspace's meeting, else the latest one.
 */
export function SummaryTab({
  meetingId,
  runSetup,
  copySourceRef,
}: {
  readonly meetingId: string | null;
  /** The session page's Copy button asks this tab for its text (spec 2.6): notes or summary. */
  readonly copySourceRef?: RefObject<(() => Promise<string | null>) | null>;
  /** Opens the engine or CLI setup when a run needs it (S18 and S19 plug in here). */
  readonly runSetup?: RunSetup;
}) {
  const { t, locale } = useI18n();
  const model = useSummaryTab(meetingId, (detail) => t('Error_SaveActionItem', detail));
  const { state } = model;
  const generation = useSummaryGeneration({
    state,
    mode: model.mode,
    loading: model.loading,
    runningAtLoad: model.runningAtLoad,
    settleNotes: model.settleNotes,
    refresh: model.refresh,
    t,
    ...(runSetup ? { runSetup } : {}),
  });
  const { flags } = generation;
  const [missingRelated, setMissingRelated] = useState(false);
  const copyMode = model.mode === 'notes' ? 'notes' : 'summary';
  useEffect(() => {
    if (!copySourceRef || meetingId === null) return;
    copySourceRef.current = async () => {
      const answer = await window.vozella.invoke('summaries.copyText', {
        meetingId,
        mode: copyMode,
      });
      return answer.text;
    };
    return () => {
      copySourceRef.current = null;
    };
  }, [copySourceRef, meetingId, copyMode]);

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
      readyToGenerate: t('Ui_SummaryReadyToGenerate'),
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
      setMissingRelated(false);
      void (async () => {
        const found = await window.vozella.invoke('chat.meetingExists', { meetingId: id });
        if (!found.exists) {
          setMissingRelated(true);
          return;
        }
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
    <>
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
        hasSummary={flags.hasSummary}
        isEmpty={flags.isEmpty}
        actionItems={model.actionItems}
        onToggleAction={model.toggleAction}
        related={related}
        onOpenRelated={onOpenRelated}
        onRecord={onRecord}
        status={model.status ?? (missingRelated ? t('Chat_MeetingLinkMissing') : null)}
        onDismissStatus={() => {
          setMissingRelated(false);
          model.dismissStatus();
        }}
        toolbarEnd={
          <SummaryActionBar
            labels={{
              generate: t('SummaryPage_Generate.Text'),
              regenerate: t('SummaryPage_RegenerateLabel.Text'),
              cancel: t('RecordPage_CancelProcessing.Content'),
              template: t('SummaryPage_NoteTemplateCompact.AutomationProperties.Name'),
              more: t('SummaryPage_More.AutomationProperties.Name'),
              copyActions: t('SummaryPage_MoreListActions.Text'),
              copy: t('SessionPage_Copy.AutomationProperties.Name'),
            }}
            showBar={flags.showSummaryActionBar}
            canGenerate={flags.canGenerate}
            canRegenerate={flags.canRegenerate}
            showMore={flags.showDraftActions}
            generating={generation.generating}
            templateOptions={generation.templateOptions}
            templateId={generation.templateId}
            onTemplateChange={generation.setTemplateId}
            onGenerate={generation.generate}
            onRegenerate={generation.askRegenerate}
            onCancel={generation.cancel}
            onCopyActions={generation.copyActions}
            // Under the session page the header's Copy button replaces this stand-in.
            canCopy={
              copySourceRef
                ? false
                : model.mode === 'notes'
                  ? model.notes.trim() !== ''
                  : flags.hasSummary
            }
            onCopy={() => {
              generation.copyText(model.mode === 'notes' ? 'notes' : 'summary');
            }}
          />
        }
        statusLine={
          <SummaryStatusLine
            status={flags.showSummaryActionBar || generation.generating ? generation.status : null}
            busy={generation.generating}
          />
        }
        draft={<DraftMessage message={generation.draft} />}
      />
      <RegenerateDialog
        open={generation.regenerateOpen}
        onClose={generation.closeRegenerate}
        onConfirm={generation.confirmRegenerate}
        labels={{
          title: t('SummaryRegenerate_Title'),
          content: t('SummaryRegenerate_Content', state?.title ?? ''),
          primary: t('SummaryRegenerate_Primary'),
          cancel: t('SummaryRegenerate_Cancel'),
          close: t('Ui_Close'),
        }}
      />
    </>
  );
}
