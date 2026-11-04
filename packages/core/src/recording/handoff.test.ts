import { describe, expect, it } from 'vitest';
import {
  decideRecordingHandoff,
  shouldShowRecordingPill,
  STARTED_HINT_DURATION_MS,
} from './handoff';

// Ports the nine LiveCopilotRecordingHandoffTests cases (182).
describe('decideRecordingHandoff', () => {
  it('Decide_WhenRecordingStarts_MinimizesAndShowsHint', () => {
    expect(decideRecordingHandoff(false, true)).toEqual({
      minimizeMainWindow: true,
      showStartedHint: true,
    });
  });
  it('Decide_WhenAlreadyRecording_DoesNotHandoff', () => {
    expect(decideRecordingHandoff(true, true)).toEqual({
      minimizeMainWindow: false,
      showStartedHint: false,
    });
  });
  it('Decide_WhenRecordingStops_DoesNotHandoff', () => {
    expect(decideRecordingHandoff(true, false).minimizeMainWindow).toBe(false);
    expect(decideRecordingHandoff(true, false).showStartedHint).toBe(false);
  });
  it('Decide_WhenIdle_DoesNotHandoff', () => {
    expect(decideRecordingHandoff(false, false).minimizeMainWindow).toBe(false);
    expect(decideRecordingHandoff(false, false).showStartedHint).toBe(false);
  });
});

describe('shouldShowRecordingPill', () => {
  it('ShouldShowPill_OnHandoffWhileMainWindowStillActive_IsTrue', () => {
    expect(shouldShowRecordingPill(true, true, true)).toBe(true);
  });
  it('ShouldShowPill_WhenRecordingAndMainWindowActive_IsFalse', () => {
    expect(shouldShowRecordingPill(true, true, false)).toBe(false);
  });
  it('ShouldShowPill_WhenRecordingAndMainWindowInactive_IsTrue', () => {
    expect(shouldShowRecordingPill(true, false, false)).toBe(true);
  });
  it('ShouldShowPill_WhenNotRecording_IsFalse', () => {
    expect(shouldShowRecordingPill(false, false, true)).toBe(false);
  });
  it('StartedHintDuration_IsTwoAndAHalfSeconds', () => {
    expect(STARTED_HINT_DURATION_MS).toBe(2500);
  });
});
