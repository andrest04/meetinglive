import type { StringKey } from '../../i18n/translate';

/** A catalog key and the values for its placeholders. */
export interface Message {
  readonly key: StringKey;
  readonly args: readonly string[];
}

export type RecordingNotice =
  | {
      readonly kind: 'source-lost';
      readonly source: 'Microphone' | 'Output';
      readonly remaining: number;
    }
  | { readonly kind: 'output-failed'; readonly message: string }
  | { readonly kind: 'faulted'; readonly message: string };

/** The status line while recording (spec 2.2). `appName` is null for all system audio. */
export function recordingStatus(input: {
  readonly microphone: boolean;
  readonly appName: string | null;
}): Message {
  const { microphone, appName } = input;
  if (appName === null) {
    return { key: microphone ? 'Status_Recording' : 'Status_RecordingNoMic', args: [] };
  }
  return {
    key: microphone ? 'Status_RecordingMicApp' : 'Status_RecordingNoMicApp',
    args: [appName],
  };
}

/** The message for a notice from the capture service (spec 2.3.3). */
export function noticeMessage(notice: RecordingNotice): Message {
  switch (notice.kind) {
    case 'source-lost':
      if (notice.remaining === 0) return { key: 'Warning_NoAudioSourcesLeft', args: [] };
      return {
        key: notice.source === 'Microphone' ? 'Warning_MicrophoneLost' : 'Warning_OutputAudioLost',
        args: [],
      };
    case 'output-failed':
      return { key: 'Error_OutputCaptureFailed', args: [notice.message] };
    case 'faulted':
      return { key: 'Error_CaptureFaulted', args: [notice.message] };
  }
}

/** Nothing outranks "no audio source left": two events can arrive out of order. */
export function chooseWarning(current: Message | null, incoming: Message): Message {
  return current?.key === 'Warning_NoAudioSourcesLeft' ? current : incoming;
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
export function startFailureMessage(code: string | undefined, message: string): Message {
  if (code === 'process-loopback-unsupported') {
    return { key: 'Ui_ProcessLoopbackUnsupported', args: [] };
  }
  return { key: 'Error_StartRecording', args: [message] };
}
