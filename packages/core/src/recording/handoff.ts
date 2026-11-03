/** How long the "Recording started" hint stays on the floating pill (spec 2.15). */
export const STARTED_HINT_DURATION_MS = 2500;

export interface RecordingHandoffDecision {
  readonly minimizeMainWindow: boolean;
  readonly showStartedHint: boolean;
}

/**
 * The start handoff: only the false to true transition of `isRecording` minimizes the main window
 * and shows the hint. Pause, resume, import, discard and stop never do (182).
 */
export function decideRecordingHandoff(
  wasRecording: boolean,
  isRecording: boolean,
): RecordingHandoffDecision {
  const started = !wasRecording && isRecording;
  return { minimizeMainWindow: started, showStartedHint: started };
}

/**
 * The pill is visible while recording and the main window is not active, or at once during the
 * start handoff even if the deactivation has not been seen yet.
 */
export function shouldShowRecordingPill(
  isRecording: boolean,
  mainWindowActive: boolean,
  handingOff: boolean,
): boolean {
  return isRecording && (!mainWindowActive || handingOff);
}
