import { describe, expect, it } from 'vitest';
import {
  chooseWarning,
  noticeMessage,
  recordingStatus,
  sourcesSummaryArgs,
} from './recording-status';

describe('recordingStatus (spec 2.2)', () => {
  it('names the four mic and output combinations', () => {
    expect(recordingStatus({ microphone: true, appName: null })).toEqual({
      key: 'Status_Recording',
      args: [],
    });
    expect(recordingStatus({ microphone: false, appName: null })).toEqual({
      key: 'Status_RecordingNoMic',
      args: [],
    });
    expect(recordingStatus({ microphone: true, appName: 'Zoom' })).toEqual({
      key: 'Status_RecordingMicApp',
      args: ['Zoom'],
    });
    expect(recordingStatus({ microphone: false, appName: 'Zoom' })).toEqual({
      key: 'Status_RecordingNoMicApp',
      args: ['Zoom'],
    });
  });
});

describe('noticeMessage (spec 2.3.3)', () => {
  it('maps a lost microphone, a lost output and an empty mix', () => {
    expect(noticeMessage({ kind: 'source-lost', source: 'Microphone', remaining: 1 })).toEqual({
      key: 'Warning_MicrophoneLost',
      args: [],
    });
    expect(noticeMessage({ kind: 'source-lost', source: 'Output', remaining: 1 })).toEqual({
      key: 'Warning_OutputAudioLost',
      args: [],
    });
    expect(noticeMessage({ kind: 'source-lost', source: 'Output', remaining: 0 })).toEqual({
      key: 'Warning_NoAudioSourcesLeft',
      args: [],
    });
    expect(noticeMessage({ kind: 'source-lost', source: 'Microphone', remaining: 0 })).toEqual({
      key: 'Warning_NoAudioSourcesLeft',
      args: [],
    });
  });

  it('carries the error text of the two stopping failures', () => {
    expect(noticeMessage({ kind: 'output-failed', message: 'gone' })).toEqual({
      key: 'Error_OutputCaptureFailed',
      args: ['gone'],
    });
    expect(noticeMessage({ kind: 'faulted', message: 'disk full' })).toEqual({
      key: 'Error_CaptureFaulted',
      args: ['disk full'],
    });
  });
});

describe('chooseWarning', () => {
  const mic = { key: 'Warning_MicrophoneLost', args: [] } as const;
  const none = { key: 'Warning_NoAudioSourcesLeft', args: [] } as const;
  it('keeps nothing-left once it was raised, even if a milder event arrives late', () => {
    expect(chooseWarning(none, mic)).toBe(none);
  });
  it('otherwise takes the newest', () => {
    expect(chooseWarning(null, mic)).toBe(mic);
    expect(chooseWarning(mic, none)).toBe(none);
  });
});

describe('sourcesSummaryArgs', () => {
  const labels = { systemDefault: 'System default', allSystem: 'All system audio' };
  it('falls back to the system default and all system audio', () => {
    expect(sourcesSummaryArgs(null, null, labels)).toEqual(['System default', 'All system audio']);
  });
  it('uses the selected names', () => {
    expect(sourcesSummaryArgs('Test headset', 'Zoom', labels)).toEqual(['Test headset', 'Zoom']);
  });
});
