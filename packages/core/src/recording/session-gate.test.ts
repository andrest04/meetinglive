import { describe, expect, it } from 'vitest';
import { RecordingSessionGate, type RecordingPhase } from './session-gate';

const at = (phase: RecordingPhase): RecordingSessionGate => {
  const gate = new RecordingSessionGate();
  const path: Record<RecordingPhase, (() => boolean)[]> = {
    Idle: [],
    Preparing: [() => gate.tryBeginPreparing()],
    Recording: [() => gate.tryBeginPreparing(), () => gate.markRecording()],
    Stopping: [
      () => gate.tryBeginPreparing(),
      () => gate.markRecording(),
      () => gate.tryBeginStopping(),
    ],
    Processing: [
      () => gate.tryBeginPreparing(),
      () => gate.markRecording(),
      () => gate.tryBeginStopping(),
      () => gate.markProcessing(),
    ],
  };
  for (const step of path[phase]) expect(step()).toBe(true);
  return gate;
};

describe('RecordingSessionGate', () => {
  it('TryBeginStopping_WhileAlreadyStopping_IsRefusedSoTheTakeIsProcessedOnce', () => {
    const gate = at('Recording');
    expect(gate.tryBeginStopping()).toBe(true);
    expect(gate.tryBeginStopping()).toBe(false);
    expect(gate.phase).toBe('Stopping');
  });

  it('Preparing_BlocksImportAndAnotherStart', () => {
    const gate = at('Preparing');
    expect(gate.canImport).toBe(false);
    expect(gate.canToggle).toBe(false);
    expect(gate.tryBeginPreparing()).toBe(false);
    expect(gate.phase).toBe('Preparing');
  });

  it('Stopping_BlocksToggleDiscardPauseAndImport', () => {
    const gate = at('Stopping');
    expect(gate.canToggle).toBe(false);
    expect(gate.canControlCapture).toBe(false);
    expect(gate.canImport).toBe(false);
    expect(gate.requiresCloseConfirmation).toBe(false);
  });

  it('Recording_AllowsStopAndCaptureControlsButNotImport', () => {
    const gate = at('Recording');
    expect(gate.canToggle).toBe(true);
    expect(gate.canControlCapture).toBe(true);
    expect(gate.canImport).toBe(false);
    expect(gate.requiresCloseConfirmation).toBe(true);
  });

  it('CancelPreparing_AfterRecordingStarted_LeavesRecordingPhase', () => {
    const gate = at('Recording');
    expect(gate.cancelPreparing()).toBe(false);
    expect(gate.phase).toBe('Recording');
  });

  it('CancelPreparing_WhenStartIsAbandoned_ReturnsToIdle', () => {
    const gate = at('Preparing');
    expect(gate.cancelPreparing()).toBe(true);
    expect(gate.phase).toBe('Idle');
    expect(gate.canToggle).toBe(true);
  });

  it('Import_GoesFromPreparingToProcessingToIdle', () => {
    const gate = at('Preparing');
    expect(gate.markProcessing()).toBe(true);
    expect(gate.phase).toBe('Processing');
    expect(gate.canToggle).toBe(false);
    expect(gate.markIdle()).toBe(true);
    expect(gate.phase).toBe('Idle');
  });

  it('Stop_GoesFromStoppingToProcessing', () => {
    const gate = at('Stopping');
    expect(gate.markProcessing()).toBe(true);
    expect(gate.phase).toBe('Processing');
  });

  it('Discard_GoesFromStoppingToIdle', () => {
    const gate = at('Stopping');
    expect(gate.markIdle()).toBe(true);
    expect(gate.phase).toBe('Idle');
  });

  it('MarkIdle_WhileRecording_IsRefusedSoALateCallbackCannotEndTheNextTake', () => {
    const gate = at('Recording');
    expect(gate.markIdle()).toBe(false);
    expect(gate.phase).toBe('Recording');
  });

  it('refuses every transition outside the table and changes nothing', () => {
    const calls: Record<string, (g: RecordingSessionGate) => boolean> = {
      tryBeginPreparing: (g) => g.tryBeginPreparing(),
      cancelPreparing: (g) => g.cancelPreparing(),
      markRecording: (g) => g.markRecording(),
      tryBeginStopping: (g) => g.tryBeginStopping(),
      markProcessing: (g) => g.markProcessing(),
      markIdle: (g) => g.markIdle(),
    };
    const allowed: Record<string, RecordingPhase[]> = {
      tryBeginPreparing: ['Idle'],
      cancelPreparing: ['Preparing'],
      markRecording: ['Preparing'],
      tryBeginStopping: ['Recording'],
      markProcessing: ['Stopping', 'Preparing'],
      markIdle: ['Processing', 'Stopping'],
    };
    const phases: RecordingPhase[] = ['Idle', 'Preparing', 'Recording', 'Stopping', 'Processing'];
    for (const [name, call] of Object.entries(calls)) {
      for (const phase of phases) {
        if (allowed[name]?.includes(phase)) continue;
        const gate = at(phase);
        expect(call(gate), `${name} from ${phase}`).toBe(false);
        expect(gate.phase).toBe(phase);
      }
    }
  });

  it('derives the four flags from the phase only', () => {
    const flags = (p: RecordingPhase) => {
      const g = at(p);
      return [g.canToggle, g.canImport, g.canControlCapture, g.requiresCloseConfirmation];
    };
    expect(flags('Idle')).toEqual([true, true, false, false]);
    expect(flags('Processing')).toEqual([false, false, false, false]);
  });

  it('notifies listeners on real transitions only, and stops after unsubscribe', () => {
    const gate = new RecordingSessionGate();
    const seen: string[] = [];
    const off = gate.onChange((phase, previous) => seen.push(`${previous}>${phase}`));
    gate.tryBeginPreparing();
    gate.tryBeginPreparing();
    gate.markRecording();
    gate.markIdle();
    off();
    gate.tryBeginStopping();
    expect(seen).toEqual(['Idle>Preparing', 'Preparing>Recording']);
  });
});
