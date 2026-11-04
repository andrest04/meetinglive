import { describe, expect, it } from 'vitest';
import {
  audioMicrophonesLoad,
  audioPreviewLevel,
  audioRecordingNotice,
  sourcePickerStateSchema,
} from './audio';
import { eventChannels, requestChannels } from './channels';
import { audioRpcCallSchema, audioWorkerCommandSchema, audioWorkerEventSchema } from './workers';

describe('audio worker messages', () => {
  const sources = {
    captureMicrophone: true,
    microphoneDeviceId: null,
    output: 'SystemLoopback',
    processId: 0,
  };

  it('accepts the capture request of the spec', () => {
    expect(
      audioRpcCallSchema.safeParse({ method: 'recordStart', path: 'a.wav', sources }).success,
    ).toBe(true);
    expect(
      audioRpcCallSchema.safeParse({
        method: 'recordStart',
        path: 'a.wav',
        sources: { ...sources, output: 'ProcessTree', processId: 4242, captureMicrophone: false },
      }).success,
    ).toBe(true);
  });

  it('rejects an empty path, an unknown output and a negative pid', () => {
    expect(audioRpcCallSchema.safeParse({ method: 'recordStart', path: '', sources }).success).toBe(
      false,
    );
    expect(
      audioRpcCallSchema.safeParse({
        method: 'recordStart',
        path: 'a.wav',
        sources: { ...sources, output: 'Both' },
      }).success,
    ).toBe(false);
    expect(
      audioRpcCallSchema.safeParse({
        method: 'recordStart',
        path: 'a.wav',
        sources: { ...sources, processId: -1 },
      }).success,
    ).toBe(false);
  });

  it('wraps a call in an rpc command with an id', () => {
    expect(
      audioWorkerCommandSchema.safeParse({ type: 'rpc', id: 1, call: { method: 'appsPeaks' } })
        .success,
    ).toBe(true);
    expect(
      audioWorkerCommandSchema.safeParse({ type: 'rpc', call: { method: 'appsPeaks' } }).success,
    ).toBe(false);
  });

  it('describes results, failures with a code, and the pushed events', () => {
    const ok = [
      { type: 'rpc-result', id: 1, ok: true, result: [] },
      { type: 'rpc-result', id: 1, ok: false, message: 'x', code: 'process-loopback-unsupported' },
      { type: 'recording-frame', pcm: new Uint8Array(6400) },
      { type: 'recording-level', level: 12 },
      { type: 'source-lost', source: 'Microphone', remaining: 1, message: 'gone' },
      { type: 'output-failed', message: 'x' },
      { type: 'faulted', message: 'x' },
      { type: 'preview-level', level: 5 },
    ];
    for (const e of ok)
      expect(audioWorkerEventSchema.safeParse(e).success, JSON.stringify(e)).toBe(true);
    expect(
      audioWorkerEventSchema.safeParse({ type: 'recording-frame', pcm: 'bytes' }).success,
    ).toBe(false);
  });
});

describe('audio page channels', () => {
  it('registers every audio channel by name', () => {
    expect(requestChannels[audioMicrophonesLoad.name]).toBe(audioMicrophonesLoad);
    expect(eventChannels[audioPreviewLevel.name]).toBe(audioPreviewLevel);
    expect(eventChannels[audioRecordingNotice.name]).toBe(audioRecordingNotice);
  });

  it('refuses a microphone kind it does not know', () => {
    expect(
      audioMicrophonesLoad.input.safeParse({ userChoice: { kind: 'Everything', deviceId: null } })
        .success,
    ).toBe(false);
    expect(audioMicrophonesLoad.input.safeParse({ userChoice: null }).success).toBe(true);
  });

  it('describes the picker state', () => {
    const state = {
      cards: [{ processId: null, app: null, isAvailable: true, level: 0 }],
      selectedProcessId: null,
      noAppsPlaying: true,
      fallbackAppName: null,
    };
    expect(sourcePickerStateSchema.safeParse(state).success).toBe(true);
    expect(sourcePickerStateSchema.safeParse({ ...state, cards: 'none' }).success).toBe(false);
  });

  it('describes the recording notices', () => {
    expect(
      audioRecordingNotice.payload.safeParse({
        kind: 'source-lost',
        source: 'Output',
        remaining: 0,
      }).success,
    ).toBe(true);
    expect(audioRecordingNotice.payload.safeParse({ kind: 'mystery' }).success).toBe(false);
  });
});
