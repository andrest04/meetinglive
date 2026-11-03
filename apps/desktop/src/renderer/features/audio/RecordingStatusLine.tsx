import { useT } from '../../i18n/I18nProvider';
import { Meter, Notice } from '../../ui';
import { recordingStatus, type Message } from './recording-status';
import { useRecordingFeedback } from './use-recording-feedback';

export interface RecordingStatusLineProps {
  readonly recording: boolean;
  readonly paused: boolean;
  /** The microphone is not None. */
  readonly microphone: boolean;
  /** Null for all system audio. */
  readonly appName: string | null;
}

/**
 * The status line and the level of a recording in progress (spec 2.2 and 2.3). A lost source
 * wins over the plain "Recording..." text, so resuming from a pause does not hide it. The
 * recording module mounts this and passes its own state; the words and the rules are here.
 */
export function RecordingStatusLine({
  recording,
  paused,
  microphone,
  appName,
}: RecordingStatusLineProps) {
  const t = useT();
  const { warning, level } = useRecordingFeedback(recording);
  if (!recording) return null;

  const message: Message = warning ?? recordingStatus({ microphone, appName });
  const text = paused && !warning ? t('Status_Paused') : t(message.key, ...message.args);

  return (
    <div className="flex flex-col gap-2" data-testid="recording-status">
      <Notice tone={warning ? 'warning' : 'info'}>{text}</Notice>
      <Meter
        value={microphone ? level : 0}
        label={t('RecordPage_MicLevelBar.AutomationProperties.Name')}
      />
    </div>
  );
}
