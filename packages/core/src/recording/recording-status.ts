import type { MicrophoneChoice } from '../audio-capture/source-picker';

/** A catalog key and the values for its placeholders. */
export interface Message<K extends string = string> {
  readonly key: K;
  readonly args: readonly string[];
}

export type RecordingStatusKey =
  | 'Status_Recording'
  | 'Status_RecordingNoMic'
  | 'Status_RecordingMicApp'
  | 'Status_RecordingNoMicApp';

/** The status line while recording (spec 2.2). `appName` is null for all system audio. */
export function recordingStatus(input: {
  readonly microphone: boolean;
  readonly appName: string | null;
}): Message<RecordingStatusKey> {
  const { microphone, appName } = input;
  if (appName === null) {
    return { key: microphone ? 'Status_Recording' : 'Status_RecordingNoMic', args: [] };
  }
  return {
    key: microphone ? 'Status_RecordingMicApp' : 'Status_RecordingNoMicApp',
    args: [appName],
  };
}

/**
 * `RecordingStatusText` (spec 3.6), used at start and on resume: a capture warning key that is
 * set wins, otherwise the four variants by microphone choice and app.
 */
export function recordingStatusText(
  selection: MicrophoneChoice,
  appName: string | null,
  warningKey: string | null,
): Message {
  if (warningKey !== null) return { key: warningKey, args: [] };
  return recordingStatus({ microphone: selection.kind !== 'None', appName });
}

/** Values for `RecordPage_SourcesSummary`: the selected names, or the defaults. */
export function sourcesSummaryArgs(
  microphoneName: string | null,
  appName: string | null,
  labels: { readonly systemDefault: string; readonly allSystem: string },
): [string, string] {
  return [microphoneName ?? labels.systemDefault, appName ?? labels.allSystem];
}

/** The message when starting a recording failed. `code` comes from the audio worker. */
export function startFailureMessage(
  code: string | undefined,
  message: string,
): Message<'Ui_ProcessLoopbackUnsupported' | 'Error_StartRecording'> {
  if (code === 'process-loopback-unsupported') {
    return { key: 'Ui_ProcessLoopbackUnsupported', args: [] };
  }
  return { key: 'Error_StartRecording', args: [message] };
}
