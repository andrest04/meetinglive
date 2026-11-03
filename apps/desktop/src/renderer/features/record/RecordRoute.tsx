import { defaultMeetingTitle } from '@vozella/core';
import { FileUp, Mic } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Button, Progress, SectionHeader } from '../../ui';
import { SourcesPanel, type SourcesSelection } from '../audio/SourcesPanel';
import { useEngineStatus } from '../transcription/use-engine-status';
import { LiveCanvas } from './LiveCanvas';
import { NotepadPanel } from './notepad/NotepadPanel';
import { RecordIdle } from './RecordIdle';
import { buildDestinations } from './destinations';
import {
  arrangePanels,
  deriveRecordLayout,
  hasStatusError,
  type StatusMessage,
} from './record-layout';
import { RecordingSession, useCanvasCopy } from './RecordingSession';
import { ResultCard } from './ResultCard';
import { SetupChecklist } from './SetupChecklist';
import { StatusBars, useStatusText } from './StatusBars';
import { useEnsureReady } from './use-ensure-ready';
import {
  cancelProcessing,
  connectRecording,
  importRecording,
  setFolderId,
  setTitle,
  startRecording,
  useRecordingStore,
} from './use-recording';
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
 * sources, hero or setup panel), the result card and the status bars are drawn here from main's
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
      className={scrollSession ? 'flex flex-col gap-6' : 'flex flex-col gap-8'}
      data-testid="record-page"
      data-session={scrollSession ? 'true' : 'false'}
    >
      <SectionHeader
        level={1}
        title={t('RecordPage_Title.Text')}
        description={isRecording ? undefined : t('RecordPage_Subtitle.Text')}
      />

      <RecordIdle
        hidden={isRecording}
        title={title}
        onTitleChange={setTitle}
        titleDisabled={isRecording || busy === 'starting'}
        folders={store.folders}
        folderId={store.folderId}
        onFolderChange={setFolderId}
        destinationDisabled={isRecording || busy === 'starting'}
      >
        <SourcesPanel active={idle} locked={!idle} onSelectionChange={setSelection} />

        {flags.showSetupPanel && setup ? (
          <SetupChecklist
            setup={setup}
            busy={busy !== null}
            onSetUp={() => {
              void ensureReady();
            }}
          />
        ) : null}

        {flags.showRecordHero && !active ? (
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
        ) : null}

        {busy === 'starting' ? (
          <p role="status" className="text-ui text-ink-muted">
            {t('Ui_TakeStarting')}
          </p>
        ) : null}

        {!active ? <StatusBars messages={messages} scope="idle" /> : null}
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
            side={<NotepadPanel maxHeight={panels.notesMaxHeight} />}
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
            <div className="flex flex-wrap items-center gap-3">
              <Button data-testid="BtnCancelProcessing" onClick={() => void cancelProcessing()}>
                {t('RecordPage_CancelProcessing.Content')}
              </Button>
              <p
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1 text-ui-lg text-ink"
                data-testid="recording-status"
              >
                {statusText}
              </p>
            </div>
            <Progress value={null} label={statusText} />
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
          <NotepadPanel />
        </div>
      ) : null}

      {savedMeeting ? (
        <ResultCard
          title={savedMeeting.title}
          onOpen={() => {
            void openMeeting(savedMeeting.id);
          }}
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

      {dialogs}
    </section>
  );
}
