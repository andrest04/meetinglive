import type { Message } from './recording-status';

/**
 * Capture failures and warnings while recording (spec 2.17). Severity is typed (B-12): the page
 * never tells an error from a notice by looking at the start of a string.
 */

export type NoticeSeverity = 'error' | 'warning' | 'info';

export interface CaptureNotice extends Message {
  readonly severity: NoticeSeverity;
}

/** What the capture service reports. */
export type CaptureEvent =
  | {
      readonly kind: 'source-lost';
      readonly source: 'Microphone' | 'Output';
      readonly remaining: number;
    }
  | { readonly kind: 'output-failed'; readonly message: string }
  | { readonly kind: 'faulted'; readonly message: string };

export const NOTHING_LEFT_KEY = 'Warning_NoAudioSourcesLeft';

export function captureNotice(event: CaptureEvent): CaptureNotice {
  switch (event.kind) {
    case 'source-lost':
      if (event.remaining === 0) {
        return { severity: 'warning', key: NOTHING_LEFT_KEY, args: [] };
      }
      return {
        severity: 'warning',
        key: event.source === 'Microphone' ? 'Warning_MicrophoneLost' : 'Warning_OutputAudioLost',
        args: [],
      };
    case 'output-failed':
      return { severity: 'error', key: 'Error_OutputCaptureFailed', args: [event.message] };
    case 'faulted':
      return { severity: 'error', key: 'Error_CaptureFaulted', args: [event.message] };
  }
}

/** Hard failures end the take and are processed as a normal stop. */
export const isHardFailure = (notice: CaptureNotice): boolean => notice.severity === 'error';

/** Nothing outranks "no audio source left": two events can arrive out of order. */
export function chooseWarning(
  current: CaptureNotice | null,
  incoming: CaptureNotice,
): CaptureNotice {
  return current?.key === NOTHING_LEFT_KEY ? current : incoming;
}

/** Only the first hard failure per take is handled: returns it, or null when it is not the first. */
export function firstFailure(
  handled: CaptureNotice | null,
  incoming: CaptureNotice,
): CaptureNotice | null {
  return handled === null && isHardFailure(incoming) ? incoming : null;
}
