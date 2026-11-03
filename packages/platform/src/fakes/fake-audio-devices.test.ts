import { describe, expect, it } from 'vitest';
import { FakeAudioSessionSource, FakeProcessInfo, seedFakeAudioApps } from './fake-audio-devices';

describe('seedFakeAudioApps', () => {
  it('adds an active session, a process and a version for each app', () => {
    const sessions = new FakeAudioSessionSource();
    const processes = new FakeProcessInfo();
    seedFakeAudioApps({ sessions, processes }, [
      { processId: 4100, exePath: 'C:/Zoom/Zoom.exe', name: 'Zoom Workplace', peak: 0.2 },
    ]);
    expect(sessions.enumerate()).toEqual([
      { processId: 4100, isSystemSounds: false, isStateActive: true, peak: 0.2 },
    ]);
    expect(sessions.readPeaks().get(4100)).toBe(0.2);
    expect(processes.getProcess(4100)?.processName).toBe('Zoom');
    expect(processes.getVersionInfo('C:/Zoom/Zoom.exe')?.fileDescription).toBe('Zoom Workplace');
  });
});
