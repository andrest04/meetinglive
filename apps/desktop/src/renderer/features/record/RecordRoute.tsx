import { FileUp, Mic, Pause, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { RecordingStatusLine } from '../audio/RecordingStatusLine';
import { SourcesPanel, type SourcesSelection } from '../audio/SourcesPanel';
import { Button, Field, Input, Notice, SectionHeader } from '../../ui';
import { EngineSetupDialog } from '../transcription/EngineSetupDialog';
import { LiveTranscript } from '../transcription/LiveTranscript';
import { useEngineStatus } from '../transcription/use-engine-status';
import { NotepadPanel } from './notepad/NotepadPanel';
import { useTake, useTakeNotesRequest } from './use-take';

const NO_SELECTION: SourcesSelection = { microphone: null, processId: null, appName: null };

/**
 * The Record page. The audio-capture module owns the Sources block, the take controls and the
 * status line; the meeting record, the notes and the transcription that follow a take belong to
 * the recording module. The transcription module owns the engine gate before a take starts and the
 * live transcript while it runs.
 */
export function RecordRoute() {
  const t = useT();
  const take = useTake();
  const [title, setTitle] = useState('');
  const [selection, setSelection] = useState<SourcesSelection>(NO_SELECTION);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupCancelled, setSetupCancelled] = useState(false);
  const { status: engine } = useEngineStatus();
  const idle = take.phase === 'idle';
  const recording = take.phase === 'recording' || take.phase === 'paused';
  const shown = recording || take.phase === 'stopping';
  const busy = take.phase === 'starting' || take.phase === 'stopping' || take.phase === 'importing';
  const micOn = selection.microphone?.kind !== 'None';

  const begin = (): Promise<void> =>
    take.start(title, selection.microphone ?? { kind: 'SystemDefault', deviceId: null });

  // Spec 2.1: recording starts only with the engine on disk. Otherwise the setup dialog runs and
  // a cancel or a failure leaves the page as it was.
  const record = async (): Promise<void> => {
    setSetupCancelled(false);
    let ready = false;
    try {
      ready = (await window.vozella.invoke('transcription.getStatus', {})).ready;
    } catch {
      // The dialog asks main to install, and shows the failure if main cannot.
    }
    if (ready) await begin();
    else setSetupOpen(true);
  };

  useTakeNotesRequest(take.phase, () => {
    void record();
  });

  return (
    <section className="flex flex-col gap-8">
      <SectionHeader
        level={1}
        title={t('RecordPage_Title.Text')}
        description={t('RecordPage_Subtitle.Text')}
      />
      <div className="flex flex-col gap-5">
        <Field label={t('RecordPage_MeetingTitle.Header')}>
          <Input
            value={title}
            disabled={!idle}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </Field>
      </div>
      <SourcesPanel active={idle} locked={!idle} onSelectionChange={setSelection} />

      <RecordingStatusLine
        recording={shown}
        listening={shown || take.phase === 'starting'}
        paused={take.phase === 'paused'}
        microphone={micOn}
        appName={selection.appName}
      />
      {take.phase === 'starting' ? (
        <Notice>{t('Ui_TakeStarting')}</Notice>
      ) : setupCancelled && !shown ? (
        <Notice>{t('Status_SetupCancelled')}</Notice>
      ) : !shown && take.notice ? (
        <Notice tone={take.notice.tone}>
          {t(take.notice.message.key, ...take.notice.message.args)}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {shown ? (
          <>
            <Button
              variant="primary"
              icon={Square}
              disabled={take.phase !== 'recording' && take.phase !== 'paused'}
              onClick={() => void take.stop()}
            >
              {t('Record_Stop')}
            </Button>
            {take.phase === 'paused' ? (
              <Button icon={Play} onClick={() => void take.resume()}>
                {t('Record_Resume')}
              </Button>
            ) : (
              <Button
                icon={Pause}
                disabled={take.phase !== 'recording'}
                onClick={() => void take.pause()}
              >
                {t('Record_Pause')}
              </Button>
            )}
          </>
        ) : (
          <>
            <Button variant="primary" icon={Mic} disabled={busy} onClick={() => void record()}>
              {t('Record_Record')}
            </Button>
            <Button icon={FileUp} disabled={busy} onClick={() => void take.importAudio(title)}>
              {t('Record_Import')}
            </Button>
          </>
        )}
      </div>
      {(shown || take.phase === 'starting') && engine?.liveEnabled ? (
        <LiveTranscript loading={take.phase === 'starting'} />
      ) : shown && engine ? (
        <p className="text-ui-lg text-ink-muted">{t('Ui_LiveSkipped')}</p>
      ) : null}
      <NotepadPanel />
      <EngineSetupDialog
        open={setupOpen}
        onFinished={(ready) => {
          setSetupOpen(false);
          if (ready) void begin();
          else setSetupCancelled(true);
        }}
      />
    </section>
  );
}
