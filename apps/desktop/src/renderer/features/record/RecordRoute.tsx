import { FileUp, Mic, Pause, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useT } from '../../i18n/I18nProvider';
import { RecordingStatusLine } from '../audio/RecordingStatusLine';
import { SourcesPanel, type SourcesSelection } from '../audio/SourcesPanel';
import { Button, Field, Input, Notice, SectionHeader, Textarea } from '../../ui';
import { useTake } from './use-take';

const NO_SELECTION: SourcesSelection = { microphone: null, processId: null, appName: null };

/**
 * The Record page. The audio-capture module owns the Sources block, the take controls and the
 * status line; the meeting record, the notes and the transcription that follow a take belong to
 * the recording module.
 */
export function RecordRoute() {
  const t = useT();
  const take = useTake();
  const [title, setTitle] = useState('');
  const [selection, setSelection] = useState<SourcesSelection>(NO_SELECTION);
  const idle = take.phase === 'idle';
  const recording = take.phase === 'recording' || take.phase === 'paused';
  const busy = take.phase === 'starting' || take.phase === 'stopping' || take.phase === 'importing';
  const micOn = selection.microphone?.kind !== 'None';

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
        <Field label={t('RecordPage_SessionNotes.Header')}>
          <Textarea rows={6} placeholder={t('RecordPage_SessionNotes.PlaceholderText')} />
        </Field>
      </div>
      <SourcesPanel active={idle} locked={!idle} onSelectionChange={setSelection} />

      {recording || take.phase === 'stopping' ? (
        <RecordingStatusLine
          recording
          paused={take.phase === 'paused'}
          microphone={micOn}
          appName={selection.appName}
        />
      ) : take.notice ? (
        <Notice tone={take.notice.tone}>
          {t(take.notice.message.key, ...take.notice.message.args)}
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {recording || take.phase === 'stopping' ? (
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
            <Button
              variant="primary"
              icon={Mic}
              disabled={busy}
              onClick={() =>
                void take.start(
                  title,
                  selection.microphone ?? { kind: 'SystemDefault', deviceId: null },
                )
              }
            >
              {t('Record_Record')}
            </Button>
            <Button icon={FileUp} disabled={busy} onClick={() => void take.importAudio(title)}>
              {t('Record_Import')}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
