import type { MeetingRecord } from '../library/meeting';
import type { Workspace } from '../library/workspace';
import { evaluateRetranscription } from '../transcription/retranscription';

export type BusyReason = 'capture' | 'run' | null;

export interface RunnerStateLike {
  readonly isRunning: boolean;
  readonly meetingId: string | null;
}

export interface SessionView {
  readonly title: string;
  readonly hasMeeting: boolean;
  readonly hasTranscript: boolean;
  /** True when the recorded audio file exists (spec 8 item 7). */
  readonly hasAudio: boolean;
}

export type SessionRecord = Pick<MeetingRecord, 'title' | 'transcript' | 'audioFilePath'>;

/** Items 5 to 7: what the header and tabs need from the record. A missing record is an empty view. */
export function deriveSessionView(
  record: SessionRecord | null,
  fileExists: (path: string) => boolean,
): SessionView {
  if (record === null)
    return { title: '', hasMeeting: false, hasTranscript: false, hasAudio: false };
  return {
    title: record.title,
    hasMeeting: true,
    hasTranscript: (record.transcript ?? '').trim() !== '',
    hasAudio: evaluateRetranscription(record, false, fileExists) === 'Available',
  };
}

/** Capture wins over a run when both hold: the capture is what the user can act on first. */
export function busyReason(
  runner: Pick<RunnerStateLike, 'isRunning'>,
  workspace: Pick<Workspace, 'state'>,
): BusyReason {
  if (workspace.state.isCaptureActive) return 'capture';
  if (runner.isRunning) return 'run';
  return null;
}

/** B4: rename is blocked only while a run targets this meeting. */
export function canRename(
  view: Pick<SessionView, 'hasMeeting'>,
  meetingId: string | null,
  runner: RunnerStateLike,
): boolean {
  return (
    view.hasMeeting && !(runner.isRunning && meetingId !== null && runner.meetingId === meetingId)
  );
}

/** Items 90 and 91: busy is any run or an active capture (B16: `busyReason` explains it). */
export function canRetranscribe(
  view: Pick<SessionView, 'hasMeeting' | 'hasAudio'>,
  reason: BusyReason,
): boolean {
  return view.hasMeeting && view.hasAudio && reason === null;
}
