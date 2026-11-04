import { defaultMeetingTitle } from '@vozella/core';
import { FileUp, Mic } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, SectionHeader, cn } from '../../ui';
import { SourcesPanel, type SourcesSelection } from '../audio/SourcesPanel';
import { useEngineStatus } from '../transcription/use-engine-status';
import { AnswerCard } from './AnswerCard';
import { LiveAskDock } from './LiveAskDock';
import { LiveCanvas } from './LiveCanvas';
import { ProcessingBar, RetryAction } from './ProcessingBar';
import { NotepadPanel } from './notepad/NotepadPanel';
import { RecordIdle } from './RecordIdle';
import { buildDestinations } from './destinations';
import {
  arrangePanels,
  deriveRecordLayout,
  hasStatusError,
  withoutSetupRepeat,
  type StatusMessage,
} from './record-layout';
import { RecordingSession, useCanvasCopy } from './RecordingSession';
import { useRecordShortcuts, type RecordShortcutHandlers } from './use-record-shortcuts';
import { ResultCard } from './ResultCard';
import { SetupChecklist } from './SetupChecklist';
import { StatusBars, useStatusText } from './StatusBars';
import { useEnsureReady } from './use-ensure-ready';
import {
  cancelBackgroundSummary,
  cancelProcessing,
  connectRecording,
  importRecording,
  retryProcessing,
  setFolderId,
  setTitle,
  startRecording,
  useRecordingStore,
} from './use-recording';
import { useLiveAskStore } from './use-live-ask';
import { useTakeNotesRequest } from './use-take-notes';

const NO_SELECTION: SourcesSelection = {
  microphone: null,
  processId: null,
  appName: null,
  summary: '',
};

const useWindowWidth = (): number => {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => {
      setWidth(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return width;
};

/** Opens the saved meeting in the Session page on the Summary tab if it has one (spec 2.13). */
async function openMeeting(id: string): Promise<void> {
  try {
    const { record } = await window.vozella.invoke('library.getMeeting', { id });
    const tab = record?.summary != null ? 'Summary' : 'Transcript';
    await window.vozella.invoke('workspace.dispatch', { action: { type: 'selectMeeting', id } });
    await window.vozella.invoke('workspace.dispatch', { action: { type: 'openSession', tab } });
  } catch {
    // The card stays; the user can open the meeting from the library.
  }
}

/**
 * The Record page: a thin container over the recording store. The idle zone (title, destination,
 * sources, setup panel), the action row, the result card and the status bars are drawn here from main's
 * state; the recording bar and the processing bar are the next packages' work and keep the
 * controls the page already had.
 */
export function RecordRoute() {
  const { t, locale } = useI18n();
  const store = useRecordingStore();
  const { state, setup, busy } = store;
  const [selection, setSelection] = useState<SourcesSelection>(NO_SELECTION);
  const { status: engine } = useEngineStatus();
  const { ensureReady, dialogs } = useEnsureReady();
  const answer = useLiveAskStore((s) => s.answer);
  const width = useWindowWidth();

  useEffect(() => connectRecording(), []);

  const phase = state?.phase ?? 'Idle';
  const active = phase !== 'Idle';
  const isRecording = state?.isRecording ?? false;
  const isProcessing = (state?.isProcessing ?? false) || (active && !isRecording);
  const idle = !active && busy === null;
  const savedMeeting =
    !active && state?.lastMeeting && state.lastMeeting.id !== store.clearedMeetingId
      ? state.lastMeeting
      : null;

  // After the hand-off the summary runs on its own; main's status says so (B-21).
  const summarizing =
    !active && (state?.status ?? []).some((message) => message.key === 'Status_GeneratingSummary');

  const flags = deriveRecordLayout({
    isRecording,
    isProcessing,
    isReadyToRecord: setup?.canRecord ?? true,
    hasCanvasTranscript: store.liveText !== '',
  });

  const defaultTitle = useMemo(
    () =>
      defaultMeetingTitle(new Date(store.defaultAtMs), locale, {
        MeetingTitleFormat: t('MeetingTitleFormat'),
        MeetingTitleDateFormat: t('MeetingTitleDateFormat'),
      }),
    [store.defaultAtMs, locale, t],
  );
  const title = isRecording ? (state?.title ?? '') : (store.title ?? defaultTitle);

  const record = useCallback(async (): Promise<void> => {
    if (!(await ensureReady())) return;
    await startRecording({ title, ...selection });
  }, [ensureReady, title, selection]);

  const importAudio = async (): Promise<void> => {
    if (!(await ensureReady())) return;
    await importRecording(title);
  };

  // Ctrl+R starts a take from the idle page (2.5); once recording, the session binds it to Stop.
  const idleShortcuts = useMemo<RecordShortcutHandlers | null>(
    () =>
      active
        ? null
        : {
            stop: { enabled: idle && flags.showRecordHero, run: () => void record() },
            pause: { enabled: false, run: () => undefined },
            discard: { enabled: false, run: () => undefined },
          },
    [active, idle, flags.showRecordHero, record],
  );
  useRecordShortcuts(idleShortcuts);

  useTakeNotesRequest(idle, () => {
    void record();
  });

  // The status the page shows: main's list while a take or a run exists, else the idle line.
  const messages: readonly StatusMessage[] = useMemo(() => {
    const fromMain = state?.status ?? [];
    if (fromMain.length > 0) return fromMain;
    if (store.notice) return [store.notice];
    if (!active && setup) return [{ ...setup.idleStatus, severity: 'info' as const }];
    return [];
  }, [state?.status, store.notice, active, setup]);
  const statusText = useStatusText(messages);
  const canvasCopy = useCanvasCopy(store.liveText);
  const destination = useMemo(() => {
    const inbox = t('Library_Inbox');
    return (
      buildDestinations(store.folders, inbox, locale).find((d) => d.folderId === store.folderId)
        ?.path ?? inbox
    );
  }, [store.folders, store.folderId, locale, t]);
  const emptyText =
    engine && !engine.liveEnabled ? t('Ui_LiveSkipped') : t('RecordPage_LiveTranscriptHint.Text');
  const captionText = hasStatusError(messages) ? '' : statusText;
  const panels = arrangePanels(width);
  const scrollSession = flags.isSessionActive;

  return (
    <section
      className={
        scrollSession
          ? 'flex flex-col gap-6'
          : // Before a take the page is a document: the 640 px text column of the 720 px layout. The
            // scroll margin keeps a control that takes focus clear of the sticky action row.
            'mx-auto flex w-full max-w-[640px] flex-col gap-8 [&_*]:scroll-mb-28'
      }
      data-testid="record-page"
      data-session={scrollSession ? 'true' : 'false'}
    >
      {active ? (
        <SectionHeader
          level={1}
          title={t('RecordPage_Title.Text')}
          description={isRecording ? undefined : t('RecordPage_Subtitle.Text')}
        />
      ) : (
        <h1 className="sr-only">{t('RecordPage_Title.Text')}</h1>
      )}

      <RecordIdle
        hidden={isRecording}
        asDocument={!active}
        title={title}
        onTitleChange={setTitle}
        titleDisabled={isRecording || busy === 'starting'}
        folders={store.folders}
        folderId={store.folderId}
        onFolderChange={setFolderId}
        destinationDisabled={isRecording || busy === 'starting'}
      >
        <SourcesPanel
          active={idle}
          locked={!idle}
          quiet={!active}
          onSelectionChange={setSelection}
        />

        {flags.showSetupPanel && setup ? <SetupChecklist setup={setup} /> : null}
      </RecordIdle>

      {isRecording && state ? (
        <>
          <StatusBars messages={messages} scope="session" />
          <RecordingSession
            state={state}
            liveText={store.liveText}
            committedText={store.committedText}
            destination={destination}
            sources={selection.summary}
            statusText={captionText}
            emptyText={emptyText}
            side={
              <div className="flex min-w-0 flex-col gap-4">
                <AnswerCard answer={answer} />
                <NotepadPanel maxHeight={panels.notesMaxHeight} />
              </div>
            }
            dock={<LiveAskDock enabled={state.phase === 'Recording'} />}
            sideBySide={panels.sideBySide}
          />
        </>
      ) : active ? (
        <div
          className={
            panels.sideBySide
              ? 'grid grid-cols-[minmax(0,1fr)_320px] items-start gap-4'
              : 'flex flex-col gap-4'
          }
          data-testid="record-session"
        >
          <div className="flex min-w-0 flex-col gap-4">
            <ProcessingBar
              statusText={statusText}
              canCancel={(state?.isProcessing ?? false) || busy === 'importing'}
              onCancel={() => void cancelProcessing()}
            />
            <StatusBars messages={messages} scope="session" />
            {flags.showTranscriptCanvas ? (
              <LiveCanvas
                heading={t(flags.canvasHeadingKey)}
                live={false}
                text={store.liveText}
                committedLines={Number.POSITIVE_INFINITY}
                emptyText={emptyText}
                highlightFeedback={null}
                statusText={null}
                copied={canvasCopy.copied}
                onCopy={null}
                className="h-96"
              />
            ) : null}
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <AnswerCard answer={answer} />
            <NotepadPanel />
          </div>
        </div>
      ) : null}

      {savedMeeting ? (
        <ResultCard
          title={savedMeeting.title}
          onOpen={() => {
            void openMeeting(savedMeeting.id);
          }}
          onCancelSummary={
            summarizing
              ? () => {
                  void cancelBackgroundSummary(savedMeeting.id);
                }
              : null
          }
        />
      ) : null}

      {!active && flags.showTranscriptCanvas ? (
        <LiveCanvas
          heading={t(flags.canvasHeadingKey)}
          live={false}
          text={store.liveText}
          committedLines={Number.POSITIVE_INFINITY}
          emptyText={emptyText}
          highlightFeedback={null}
          statusText={null}
          copied={canvasCopy.copied}
          onCopy={canvasCopy.copy}
          surfaceTestId="saved-transcript"
          className="h-96"
        />
      ) : null}

      {!active ? (
        // Last in the page and sticky, so the next step stays in view however long the page gets. The
        // offset cancels the scroll container's bottom padding: nothing shows under the row. The
        // status caption is centered for the old hero; here it lines up with the buttons under it.
        <div
          className={cn(
            'sticky -bottom-8 z-10 flex flex-col gap-3 border-t border-hairline bg-paper py-3',
            '[&_[data-testid=status-text]]:mx-0 [&_[data-testid=status-text]]:text-left',
            flags.showSetupPanel && '-mt-6',
          )}
          data-testid="record-actions"
        >
          {busy === 'starting' ? (
            <p role="status" className="text-ui text-ink-muted">
              {t('Ui_TakeStarting')}
            </p>
          ) : null}
          <StatusBars messages={withoutSetupRepeat(messages, flags.showSetupPanel)} scope="idle" />
          {state?.canRetry ? (
            <RetryAction
              onRetry={() => {
                void retryProcessing();
              }}
            />
          ) : null}
          {flags.showSetupPanel && setup ? (
            <div>
              <Button
                variant="primary"
                disabled={busy !== null}
                onClick={() => {
                  void ensureReady();
                }}
                data-testid="BtnSetUpToRecord"
              >
                {t('RecordingSetup_SetUpToRecord.Content')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-3" data-testid="record-hero">
                <Button
                  variant="primary"
                  icon={Mic}
                  disabled={busy !== null}
                  data-testid="BtnRecord"
                  onClick={() => void record()}
                >
                  {t('Record_Record')}
                </Button>
                {flags.showImportAudio ? (
                  <Button
                    icon={FileUp}
                    disabled={busy !== null}
                    data-testid="BtnImportAudio"
                    onClick={() => void importAudio()}
                  >
                    {t('Record_Import')}
                  </Button>
                ) : null}
              </div>
              <p className="text-ui text-ink-muted">{t('Ui_RecordHelper')}</p>
            </div>
          )}
        </div>
      ) : null}

      {dialogs}
    </section>
  );
}
