import { captureNotice, NOTHING_LEFT_KEY, type CaptureEvent } from '@vozella/core';
import type { StringKey } from '../../i18n/translate';

// The pure rules live in packages/core/src/recording; this file adapts them to catalog keys.
export { recordingStatus, sourcesSummaryArgs, startFailureMessage } from '@vozella/core';

/** A catalog key and the values for its placeholders. */
export interface Message {
  readonly key: StringKey;
  readonly args: readonly string[];
}

export type RecordingNotice = CaptureEvent;

/** The message for a notice from the capture service (spec 2.3.3). */
export function noticeMessage(notice: RecordingNotice): Message {
  const { key, args } = captureNotice(notice);
  return { key: key as StringKey, args };
}

/** Nothing outranks "no audio source left": two events can arrive out of order. */
export function chooseWarning(current: Message | null, incoming: Message): Message {
  return current?.key === NOTHING_LEFT_KEY ? current : incoming;
}
