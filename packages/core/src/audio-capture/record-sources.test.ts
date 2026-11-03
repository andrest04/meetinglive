import { describe, expect, it } from 'vitest';
import type { ActiveAudioApp, ProcessDetails, ProcessInfoProvider } from './active-audio-apps';
import {
  buildCaptureSources,
  buildMicrophoneOptions,
  RecordSourcePicker,
  sameMicrophoneOptions,
  selectMicrophoneAfterReload,
} from './record-sources';
import {
  isAppStillRunning,
  mergeActiveApps,
  NO_MICROPHONE,
  rememberAppPatch,
  rememberMicrophonePatch,
  rememberSystemAudioPatch,
  restoreApp,
  restoreMicrophone,
  suggestMeetingApp,
  SYSTEM_DEFAULT_MICROPHONE,
} from './source-picker';

const app = (
  processId: number,
  friendlyName: string,
  extra: Partial<ActiveAudioApp> = {},
): ActiveAudioApp => ({
  processId,
  exePath: `C:\\Apps\\${friendlyName}.exe`,
  friendlyName,
  isBrowser: false,
  isKnownMeetingApp: false,
  peak: 0.1,
  ...extra,
});

function processes(table: Record<number, Partial<ProcessDetails>>): ProcessInfoProvider {
  return {
    getProcess: (pid) => {
      const row = table[pid];
      return row
        ? {
            processId: pid,
            parentProcessId: 0,
            exePath: null,
            processName: 'x',
            startTimeUtcMs: null,
            ...row,
          }
        : null;
    },
    getVersionInfo: () => null,
  };
}

describe('mergeActiveApps', () => {
  it('returns every active app as available when nothing is selected', () => {
    const entries = mergeActiveApps([app(1, 'A'), app(2, 'B')], null);
    expect(entries.map((e) => e.isAvailable)).toEqual([true, true]);
  });

  it('keeps a selected app that still plays without a duplicate', () => {
    const a = app(1, 'A');
    expect(mergeActiveApps([a, app(2, 'B')], a)).toHaveLength(2);
  });

  it('keeps a stopped selected app as unavailable, in name order', () => {
    const gone = app(9, 'Bravo');
    const entries = mergeActiveApps([app(1, 'Alpha'), app(2, 'Charlie')], gone);
    expect(entries.map((e) => [e.app.friendlyName, e.isAvailable])).toEqual([
      ['Alpha', true],
      ['Bravo', false],
      ['Charlie', true],
    ]);
    expect(mergeActiveApps([app(1, 'Alpha')], gone).at(-1)?.isAvailable).toBe(false);
  });

  it('is empty with nothing playing and nothing selected', () => {
    expect(mergeActiveApps([], null)).toEqual([]);
  });
});

describe('isAppStillRunning', () => {
  const a = app(5, 'Zoom');
  it('is false when the process is gone', () => {
    expect(isAppStillRunning(a, processes({}))).toBe(false);
  });
  it('is true for the same image, ignoring case', () => {
    expect(isAppStillRunning(a, processes({ 5: { exePath: 'c:\\apps\\ZOOM.EXE' } }))).toBe(true);
  });
  it('is false when the pid was reused by another image', () => {
    expect(isAppStillRunning(a, processes({ 5: { exePath: 'C:\\Other\\x.exe' } }))).toBe(false);
  });
  it('trusts the existing process when a path is unreadable', () => {
    expect(isAppStillRunning(a, processes({ 5: { exePath: null } }))).toBe(true);
    expect(
      isAppStillRunning({ ...a, exePath: null }, processes({ 5: { exePath: 'C:\\x.exe' } })),
    ).toBe(true);
  });
});

describe('suggestMeetingApp', () => {
  const zoom = app(1, 'Zoom', { isKnownMeetingApp: true, peak: 0.2 });
  const teams = app(2, 'Teams', { isKnownMeetingApp: true, peak: 0.5 });
  it('suggests a playing meeting app', () => {
    expect(suggestMeetingApp([zoom], true, new Set())).toBe(zoom);
  });
  it('suggests nothing when an app is already selected', () => {
    expect(suggestMeetingApp([zoom], false, new Set())).toBeNull();
  });
  it('suggests nothing without a meeting app or with an empty list', () => {
    expect(suggestMeetingApp([app(3, 'Notepad')], true, new Set())).toBeNull();
    expect(suggestMeetingApp([], true, new Set())).toBeNull();
  });
  it('skips a dismissed pid without hiding another app', () => {
    expect(suggestMeetingApp([zoom, teams], true, new Set([2]))).toBe(zoom);
  });
  it('the loudest wins, equal loudness goes by name', () => {
    expect(suggestMeetingApp([zoom, teams], true, new Set())).toBe(teams);
    const a = { ...zoom, peak: 0.4 };
    const b = { ...teams, peak: 0.4 };
    expect(suggestMeetingApp([b, a], true, new Set())).toBe(b);
  });
});

describe('remembered choices', () => {
  const blank = {
    recordMicrophoneKind: null,
    recordMicrophoneDeviceId: null,
    recordOutputKind: null,
    recordAppExePath: null,
    recordAppName: null,
    selectedMicrophoneDeviceId: null,
  };

  it('remembers a device with its kind and id, and clears the id for other kinds', () => {
    expect(rememberMicrophonePatch({ kind: 'Device', deviceId: 'd1' })).toEqual({
      recordMicrophoneKind: 'Device',
      recordMicrophoneDeviceId: 'd1',
    });
    expect(rememberMicrophonePatch(NO_MICROPHONE)).toEqual({
      recordMicrophoneKind: 'None',
      recordMicrophoneDeviceId: null,
    });
    expect(rememberMicrophonePatch(SYSTEM_DEFAULT_MICROPHONE).recordMicrophoneKind).toBe(
      'SystemDefault',
    );
  });

  it('remembers an app, and system audio clears the app', () => {
    expect(rememberAppPatch('C:\\z.exe', 'Zoom')).toEqual({
      recordOutputKind: 'App',
      recordAppExePath: 'C:\\z.exe',
      recordAppName: 'Zoom',
    });
    expect(rememberSystemAudioPatch()).toEqual({
      recordOutputKind: 'System',
      recordAppExePath: null,
      recordAppName: null,
    });
  });

  it('uses the Settings microphone when nothing is remembered', () => {
    expect(restoreMicrophone({ ...blank, selectedMicrophoneDeviceId: 'd1' }, ['d1'])).toEqual({
      kind: 'Device',
      deviceId: 'd1',
    });
    expect(restoreMicrophone(blank, ['d1'])).toEqual(SYSTEM_DEFAULT_MICROPHONE);
    expect(restoreMicrophone({ ...blank, selectedMicrophoneDeviceId: 'gone' }, ['d1'])).toEqual(
      SYSTEM_DEFAULT_MICROPHONE,
    );
  });

  it('keeps a remembered None, restores a plugged device and falls back to System default when unplugged', () => {
    expect(restoreMicrophone({ ...blank, recordMicrophoneKind: 'None' }, [])).toEqual(
      NO_MICROPHONE,
    );
    const device = { ...blank, recordMicrophoneKind: 'device', recordMicrophoneDeviceId: 'd1' };
    expect(restoreMicrophone(device, ['d1'])).toEqual({ kind: 'Device', deviceId: 'd1' });
    expect(restoreMicrophone(device, ['d2'])).toEqual(SYSTEM_DEFAULT_MICROPHONE);
  });

  it('falls back to the Settings microphone for an unknown kind', () => {
    const odd = { ...blank, recordMicrophoneKind: 'Bogus', selectedMicrophoneDeviceId: 'd1' };
    expect(restoreMicrophone(odd, ['d1'])).toEqual({ kind: 'Device', deviceId: 'd1' });
  });

  it('compares device ids exactly', () => {
    const device = { ...blank, recordMicrophoneKind: 'Device', recordMicrophoneDeviceId: 'Dev' };
    expect(restoreMicrophone(device, ['dev'])).toEqual(SYSTEM_DEFAULT_MICROPHONE);
  });

  it('restores an app by executable path, ignoring case, with the current pid', () => {
    const settings = { recordOutputKind: 'app', recordAppExePath: 'C:\\APPS\\zoom.exe' };
    const zoom = app(77, 'Zoom', { exePath: 'c:\\apps\\ZOOM.exe' });
    expect(restoreApp(settings, [zoom])?.processId).toBe(77);
  });

  it('S11: with two running instances of one exe, restores the first in list order', () => {
    const settings = { recordOutputKind: 'app', recordAppExePath: 'C:\\apps\\zoom.exe' };
    const first = app(30, 'Zoom', { exePath: 'C:\\apps\\zoom.exe' });
    const second = app(20, 'Zoom', { exePath: 'C:\\apps\\zoom.exe' });
    expect(restoreApp(settings, [first, second])?.processId).toBe(30);
    expect(restoreApp(settings, [second, first])?.processId).toBe(20);
  });

  it('restores no app when none is remembered, system audio is remembered, it is not playing or no path', () => {
    const zoom = app(77, 'Zoom');
    expect(restoreApp({ recordOutputKind: null, recordAppExePath: null }, [zoom])).toBeNull();
    expect(
      restoreApp({ recordOutputKind: 'System', recordAppExePath: zoom.exePath }, [zoom]),
    ).toBeNull();
    expect(
      restoreApp({ recordOutputKind: 'App', recordAppExePath: 'C:\\no.exe' }, [zoom]),
    ).toBeNull();
    expect(restoreApp({ recordOutputKind: 'App', recordAppExePath: '  ' }, [zoom])).toBeNull();
  });
});

describe('microphone options', () => {
  const devices = [
    { id: 'a', name: 'Mic A' },
    { id: '', name: 'Broken' },
    { id: 'b', name: 'Mic B' },
  ];

  it('lists None, System default, then devices, skipping an empty id', () => {
    expect(buildMicrophoneOptions(devices).map((o) => [o.kind, o.name])).toEqual([
      ['None', null],
      ['SystemDefault', null],
      ['Device', 'Mic A'],
      ['Device', 'Mic B'],
    ]);
  });

  it('treats an identical list as the same', () => {
    expect(
      sameMicrophoneOptions(buildMicrophoneOptions(devices), buildMicrophoneOptions(devices)),
    ).toBe(true);
    expect(
      sameMicrophoneOptions(
        buildMicrophoneOptions(devices),
        buildMicrophoneOptions(devices.slice(0, 1)),
      ),
    ).toBe(false);
    const renamed = [{ id: 'a', name: 'Other' }];
    expect(
      sameMicrophoneOptions(
        buildMicrophoneOptions(renamed),
        buildMicrophoneOptions(devices.slice(0, 1)),
      ),
    ).toBe(false);
  });

  it('keeps the user choice, falls back from a vanished device to System default, else uses the remembered one', () => {
    const options = buildMicrophoneOptions(devices);
    const dev = { kind: 'Device', deviceId: 'a' } as const;
    expect(selectMicrophoneAfterReload(options, dev, NO_MICROPHONE)).toEqual(dev);
    expect(
      selectMicrophoneAfterReload(options, { kind: 'Device', deviceId: 'gone' }, NO_MICROPHONE),
    ).toEqual(SYSTEM_DEFAULT_MICROPHONE);
    expect(selectMicrophoneAfterReload(options, null, NO_MICROPHONE)).toEqual(NO_MICROPHONE);
    expect(selectMicrophoneAfterReload(options, NO_MICROPHONE, dev)).toEqual(NO_MICROPHONE);
  });

  it('builds the capture request: None is mic off, System default is mic on without id', () => {
    expect(buildCaptureSources(NO_MICROPHONE, null)).toMatchObject({
      captureMicrophone: false,
      output: 'SystemLoopback',
    });
    expect(buildCaptureSources(SYSTEM_DEFAULT_MICROPHONE, null)).toMatchObject({
      captureMicrophone: true,
      microphoneDeviceId: null,
    });
    expect(buildCaptureSources({ kind: 'Device', deviceId: 'a' }, 4242)).toEqual({
      captureMicrophone: true,
      microphoneDeviceId: 'a',
      output: 'ProcessTree',
      processId: 4242,
    });
  });
});

describe('RecordSourcePicker', () => {
  const zoom = app(1, 'Zoom', { isKnownMeetingApp: true, peak: 0.3 });
  const chrome = app(2, 'Chrome', { isBrowser: true });

  it('starts on all system audio with the system card first and no apps hint', () => {
    const picker = new RecordSourcePicker();
    const state = picker.state;
    expect(state.cards).toHaveLength(1);
    expect(state.cards[0]?.processId).toBeNull();
    expect(state.selectedProcessId).toBeNull();
    expect(state.noAppsPlaying).toBe(true);
  });

  it('shows app cards with meter values and hides the hint', () => {
    const picker = new RecordSourcePicker();
    picker.applyRefresh([chrome, zoom]);
    const state = picker.state;
    expect(state.cards.map((c) => c.processId)).toEqual(
      [null, 1, 2].slice(0, 1).concat([2, 1]).slice(0, 3),
    );
    expect(state.noAppsPlaying).toBe(false);
    expect(state.cards[2]?.level).toBeGreaterThan(50);
    picker.applyPeaks(new Map([[1, 0]]));
    expect(picker.state.cards.find((c) => c.processId === 1)?.level).toBe(0);
  });

  it('suggests the meeting app only while all system audio is selected', () => {
    const picker = new RecordSourcePicker();
    picker.applyRefresh([zoom]);
    expect(picker.state.suggestion?.processId).toBe(1);
    picker.dismissSuggestion(1);
    expect(picker.state.suggestion).toBeNull();
    const other = new RecordSourcePicker();
    other.applyRefresh([zoom]);
    other.select(1);
    expect(other.state.suggestion).toBeNull();
  });

  it('keeps a selected app that stops playing as an unavailable card at level 0', () => {
    const picker = new RecordSourcePicker();
    picker.applyRefresh([zoom, chrome]);
    expect(picker.select(1)).toBe(true);
    expect(picker.select(1)).toBe(false);
    picker.applyRefresh([chrome]);
    const card = picker.state.cards.find((c) => c.processId === 1);
    expect(card).toMatchObject({ isAvailable: false, level: 0 });
    expect(picker.state.selectedProcessId).toBe(1);
    // An unavailable selected app does not count as playing.
    picker.applyRefresh([]);
    expect(picker.state.noAppsPlaying).toBe(true);
  });

  it('restores the remembered app once per polling start, only if the user has not picked', () => {
    const picker = new RecordSourcePicker();
    picker.beginPolling();
    picker.applyRefresh([zoom], () => zoom);
    expect(picker.state.selectedProcessId).toBe(1);

    const touched = new RecordSourcePicker();
    touched.applyRefresh([zoom, chrome]);
    touched.select(2);
    touched.beginPolling();
    touched.applyRefresh([zoom, chrome], () => zoom);
    expect(touched.state.selectedProcessId).toBe(2);

    const once = new RecordSourcePicker();
    once.beginPolling();
    once.applyRefresh([], () => null);
    once.applyRefresh([zoom], () => zoom);
    expect(once.state.selectedProcessId).toBeNull();
  });

  it('returns the root pid at record time when the app still runs', () => {
    const picker = new RecordSourcePicker();
    picker.applyRefresh([zoom]);
    picker.select(1);
    const target = picker.resolveRecordingTarget(processes({ 1: { exePath: zoom.exePath } }));
    expect(target).toBe(1);
    expect(picker.state.fallbackAppName).toBeNull();
  });

  it('falls back to all system audio with a message when the app is gone', () => {
    const picker = new RecordSourcePicker();
    picker.applyRefresh([zoom]);
    picker.select(1);
    expect(picker.resolveRecordingTarget(processes({}))).toBeNull();
    expect(picker.state.fallbackAppName).toBe('Zoom');
    expect(picker.state.selectedProcessId).toBeNull();
    picker.closeFallback();
    expect(picker.state.fallbackAppName).toBeNull();
  });

  it('returns null target for all system audio', () => {
    expect(new RecordSourcePicker().resolveRecordingTarget(processes({}))).toBeNull();
  });
});
