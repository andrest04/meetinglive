import { describe, expect, it } from 'vitest';
import { NO_MICROPHONE, SYSTEM_DEFAULT_MICROPHONE } from '../audio-capture/source-picker';
import { recordingStatusText } from './recording-status';

describe('recordingStatusText (spec 3.6)', () => {
  const device = { kind: 'Device', deviceId: 'mic-1' } as const;
  it('names the four variants', () => {
    expect(recordingStatusText(SYSTEM_DEFAULT_MICROPHONE, null, null)).toEqual({
      key: 'Status_Recording',
      args: [],
    });
    expect(recordingStatusText(NO_MICROPHONE, null, null).key).toBe('Status_RecordingNoMic');
    expect(recordingStatusText(device, 'Zoom', null)).toEqual({
      key: 'Status_RecordingMicApp',
      args: ['Zoom'],
    });
    expect(recordingStatusText(NO_MICROPHONE, 'Zoom', null)).toEqual({
      key: 'Status_RecordingNoMicApp',
      args: ['Zoom'],
    });
  });
  it('a capture warning key outranks the variants and is what resume shows', () => {
    expect(recordingStatusText(device, 'Zoom', 'Warning_MicrophoneLost')).toEqual({
      key: 'Warning_MicrophoneLost',
      args: [],
    });
  });
});
