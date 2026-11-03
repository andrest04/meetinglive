import type { AudioRpcCall, EventChannel } from '@vozella/contracts';
import { readSettings, type AppSettings, type Logger, type SettingsStore } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { AudioPushEvent } from '../workers/audio-worker-host';
import {
  AudioController,
  FULL_REFRESH_EVERY_TICKS,
  type AudioHostLike,
  type Scheduler,
} from './audio-controller';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const app = (processId: number, friendlyName: string, peak = 0.3) => ({
  processId,
  exePath: `C:\\Apps\\${friendlyName}.exe`,
  friendlyName,
  isBrowser: false,
  isKnownMeetingApp: friendlyName === 'Zoom',
  peak,
});

class FakeHost implements AudioHostLike {
  calls: AudioRpcCall[] = [];
  listeners = new Set<(e: AudioPushEvent) => void>();
  apps = [app(1, 'Zoom'), app(2, 'Chrome')];
  peaks: [number, number][] = [[1, 0.5]];
  microphones = [{ id: 'd1', name: 'Mic one' }];
  process: unknown = { processId: 1, exePath: 'C:\\Apps\\Zoom.exe' };
  failApps = false;
  failMics = false;
  failStart: Error | undefined;

  call<T>(call: AudioRpcCall): Promise<T> {
    this.calls.push(call);
    switch (call.method) {
      case 'appsRefresh':
        return this.failApps ? Promise.reject(new Error('boom')) : Promise.resolve(this.apps as T);
      case 'appsPeaks':
        return Promise.resolve(this.peaks as T);
      case 'listMicrophones':
        return this.failMics
          ? Promise.reject(new Error('no audio service'))
          : Promise.resolve(this.microphones as T);
      case 'recordStart':
        return this.failStart ? Promise.reject(this.failStart) : Promise.resolve(null as T);
      case 'getProcess':
        return Promise.resolve(this.process as T);
      default:
        return Promise.resolve(null as T);
    }
  }
  onPush(listener: (e: AudioPushEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  push(e: AudioPushEvent): void {
    for (const l of this.listeners) l(e);
  }
  methods(): string[] {
    return this.calls.map((c) => c.method);
  }
}

class ManualScheduler implements Scheduler {
  task: (() => void) | undefined;
  every(_ms: number, task: () => void): () => void {
    this.task = task;
    return () => {
      this.task = undefined;
    };
  }
  async tick(times = 1): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      this.task?.();
      await flush();
    }
  }
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

class MemorySettings implements SettingsStore {
  current: AppSettings = readSettings({});
  failLoad = false;
  failUpdate = false;
  load(): Promise<AppSettings> {
    return this.failLoad ? Promise.reject(new Error('locked')) : Promise.resolve(this.current);
  }
  update(patch: Partial<AppSettings>): Promise<AppSettings> {
    if (this.failUpdate) return Promise.reject(new Error('locked'));
    this.current = { ...this.current, ...patch };
    return Promise.resolve(this.current);
  }
}

function rig() {
  const host = new FakeHost();
  const settings = new MemorySettings();
  const scheduler = new ManualScheduler();
  const events: { name: string; payload: unknown }[] = [];
  const controller = new AudioController({
    host,
    settings,
    scheduler,
    logger,
    broadcast: (channel: EventChannel, payload: unknown) => {
      events.push({ name: channel.name, payload });
    },
  });
  return { host, settings, scheduler, events, controller };
}

describe('microphones', () => {
  it('lists None, System default and the devices, and picks the remembered choice', async () => {
    const r = rig();
    r.settings.current = readSettings({
      recordMicrophoneKind: 'Device',
      recordMicrophoneDeviceId: 'd1',
    });
    const { options, selected } = await r.controller.loadMicrophones(null);
    expect(options.map((o) => o.kind)).toEqual(['None', 'SystemDefault', 'Device']);
    expect(selected).toEqual({ kind: 'Device', deviceId: 'd1' });
  });

  it('keeps the choice the user already made, and falls back to System default for a vanished device', async () => {
    const r = rig();
    expect(
      (await r.controller.loadMicrophones({ kind: 'None', deviceId: null })).selected.kind,
    ).toBe('None');
    const gone = await r.controller.loadMicrophones({ kind: 'Device', deviceId: 'gone' });
    expect(gone.selected).toEqual({ kind: 'SystemDefault', deviceId: null });
  });

  it('S12: an audio service failure gives only None and System default', async () => {
    const r = rig();
    r.host.failMics = true;
    const { options } = await r.controller.loadMicrophones(null);
    expect(options.map((o) => o.kind)).toEqual(['None', 'SystemDefault']);
  });

  it('falls back to System default when the settings cannot be read', async () => {
    const r = rig();
    r.settings.failLoad = true;
    expect((await r.controller.loadMicrophones(null)).selected.kind).toBe('SystemDefault');
  });

  it('remembers a choice and ignores a saving failure', async () => {
    const r = rig();
    expect(await r.controller.rememberMicrophone({ kind: 'Device', deviceId: 'd1' })).toBe(true);
    expect(r.settings.current).toMatchObject({
      recordMicrophoneKind: 'Device',
      recordMicrophoneDeviceId: 'd1',
    });
    r.settings.failUpdate = true;
    expect(await r.controller.rememberMicrophone({ kind: 'None', deviceId: null })).toBe(false);
  });
});

describe('source polling', () => {
  it('publishes an immediate full refresh, then peaks, with a full refresh every tenth tick', async () => {
    const r = rig();
    const state = await r.controller.startSources();
    expect(state.cards.map((c) => c.processId)).toEqual([null, 1, 2]);
    expect(r.host.methods()).toEqual(['appsRefresh']);
    await r.scheduler.tick(FULL_REFRESH_EVERY_TICKS);
    expect(r.host.methods().filter((m) => m === 'appsPeaks')).toHaveLength(
      FULL_REFRESH_EVERY_TICKS - 1,
    );
    expect(r.host.methods().filter((m) => m === 'appsRefresh')).toHaveLength(2);
    expect(r.events.every((e) => e.name === 'audio.sources.changed')).toBe(true);
  });

  it('ends the loop silently when the audio service fails', async () => {
    const r = rig();
    await r.controller.startSources();
    r.host.failApps = true;
    await r.scheduler.tick(FULL_REFRESH_EVERY_TICKS);
    expect(r.scheduler.task).toBeUndefined();
  });

  it('restores the remembered app once, after the first enumeration', async () => {
    const r = rig();
    r.settings.current = readSettings({
      recordOutputKind: 'App',
      recordAppExePath: 'c:\\apps\\zoom.exe',
    });
    const state = await r.controller.startSources();
    expect(state.selectedProcessId).toBe(1);
    // Remembered, not re-saved: restoring is not a user pick.
    expect(r.settings.current.recordOutputKind).toBe('App');
  });

  it('leaves all system audio selected when the settings cannot be read', async () => {
    const r = rig();
    r.settings.failLoad = true;
    expect((await r.controller.startSources()).selectedProcessId).toBeNull();
  });

  it('does not restore an app that is not playing', async () => {
    const r = rig();
    r.settings.current = readSettings({ recordOutputKind: 'App', recordAppExePath: 'C:\\no.exe' });
    expect((await r.controller.startSources()).selectedProcessId).toBeNull();
  });

  it('remembers a user pick, and system audio clears the app', async () => {
    const r = rig();
    await r.controller.startSources();
    await r.controller.select(2);
    expect(r.settings.current).toMatchObject({
      recordOutputKind: 'App',
      recordAppName: 'Chrome',
      recordAppExePath: 'C:\\Apps\\Chrome.exe',
    });
    await r.controller.select(null);
    expect(r.settings.current).toMatchObject({
      recordOutputKind: 'System',
      recordAppExePath: null,
    });
  });

  it('does not save when the already selected card is picked again', async () => {
    const r = rig();
    await r.controller.startSources();
    const update = vi.spyOn(r.settings, 'update');
    await r.controller.select(null);
    expect(update).not.toHaveBeenCalled();
  });

  it('stopping zeroes the meters and ignores a refresh still in flight', async () => {
    const r = rig();
    await r.controller.startSources();
    r.controller.stopSources();
    expect(r.scheduler.task).toBeUndefined();
    expect(r.controller.pickerState.cards.every((c) => c.level === 0)).toBe(true);
  });
});

describe('recording', () => {
  const mic = { kind: 'SystemDefault' as const, deviceId: null };

  it('records all system audio with the microphone and stops the picker and the preview', async () => {
    const r = rig();
    await r.controller.startSources();
    const sources = await r.controller.startRecording('C:\\lib\\a.wav', mic);
    expect(sources).toEqual({
      captureMicrophone: true,
      microphoneDeviceId: null,
      output: 'SystemLoopback',
      processId: 0,
    });
    expect(r.host.methods()).toContain('previewStop');
    expect(r.host.calls.at(-1)).toMatchObject({ method: 'recordStart', path: 'C:\\lib\\a.wav' });
    expect(r.scheduler.task).toBeUndefined();
    expect(r.controller.isRecording).toBe(true);
    await r.controller.stop();
    expect(r.controller.isRecording).toBe(false);
  });

  it('captures the selected app by its root pid', async () => {
    const r = rig();
    await r.controller.startSources();
    await r.controller.select(1);
    const sources = await r.controller.startRecording('a.wav', { kind: 'None', deviceId: null });
    expect(sources).toMatchObject({
      captureMicrophone: false,
      output: 'ProcessTree',
      processId: 1,
    });
  });

  it('falls back to all system audio with the message when the app is gone', async () => {
    const r = rig();
    await r.controller.startSources();
    await r.controller.select(1);
    r.host.process = null;
    const sources = await r.controller.startRecording('a.wav', mic);
    expect(sources.output).toBe('SystemLoopback');
    expect(r.controller.pickerState).toMatchObject({
      fallbackAppName: 'Zoom',
      selectedProcessId: null,
    });
  });

  it('rejects a recycled pid that now runs another image', async () => {
    const r = rig();
    await r.controller.startSources();
    await r.controller.select(1);
    r.host.process = { processId: 1, exePath: 'C:\\Other\\thing.exe' };
    expect((await r.controller.startRecording('a.wav', mic)).output).toBe('SystemLoopback');
  });

  it('stays not recording when the worker refuses the start', async () => {
    const r = rig();
    r.host.failStart = new Error('needs a newer Windows');
    await expect(r.controller.startRecording('a.wav', mic)).rejects.toThrow('newer Windows');
    expect(r.controller.isRecording).toBe(false);
  });
});

describe('pushed events', () => {
  it('turns worker events into level and notice events and frames for subscribers', () => {
    const r = rig();
    const frames: number[] = [];
    r.controller.onRecordingFrame((f) => frames.push(f.samples.length));
    r.host.push({ type: 'preview-level', level: 140 });
    r.host.push({ type: 'recording-level', level: -5 });
    r.host.push({ type: 'recording-frame', pcm: new Uint8Array(6400) });
    r.host.push({ type: 'source-lost', source: 'Microphone', remaining: 1, message: 'gone' });
    r.host.push({ type: 'output-failed', message: 'died' });
    r.host.push({ type: 'faulted', message: 'disk full' });
    expect(frames).toEqual([3200]);
    expect(r.events).toEqual([
      { name: 'audio.preview.level', payload: { level: 100 } },
      { name: 'audio.recording.level', payload: { level: 0 } },
      {
        name: 'audio.recording.notice',
        payload: { kind: 'source-lost', source: 'Microphone', remaining: 1 },
      },
      { name: 'audio.recording.notice', payload: { kind: 'output-failed', message: 'died' } },
      { name: 'audio.recording.notice', payload: { kind: 'faulted', message: 'disk full' } },
    ]);
  });

  it('57: keeps the notices of the running take until it stops, and starts each take clean', async () => {
    const r = rig();
    await r.controller.startRecording('a.wav', { kind: 'SystemDefault', deviceId: null });
    r.host.push({ type: 'source-lost', source: 'Output', remaining: 1, message: 'gone' });
    r.host.push({ type: 'output-failed', message: 'died' });
    expect(r.controller.pendingNotices).toEqual([
      { kind: 'source-lost', source: 'Output', remaining: 1 },
      { kind: 'output-failed', message: 'died' },
    ]);
    await r.controller.stop();
    expect(r.controller.pendingNotices).toEqual([]);
    r.host.push({ type: 'faulted', message: 'late' });
    expect(r.controller.pendingNotices).toEqual([]);
  });

  it('stops listening on dispose', () => {
    const r = rig();
    r.controller.dispose();
    r.host.push({ type: 'preview-level', level: 10 });
    expect(r.events).toEqual([]);
  });
});

describe('import and preview', () => {
  it('stops the preview, then imports without a timeout', async () => {
    const r = rig();
    await r.controller.importAudio('a.mp3', 'b.wav');
    expect(r.host.methods()).toEqual(['previewStop', 'importAudio']);
  });

  it('starts and stops the preview through the worker', async () => {
    const r = rig();
    r.controller.startPreview('d1');
    r.controller.stopPreview();
    await flush();
    expect(r.host.calls).toEqual([
      { method: 'previewStart', deviceId: 'd1' },
      { method: 'previewStop' },
    ]);
  });
});

describe('preview ownership (B-32)', () => {
  const previewCalls = (r: ReturnType<typeof rig>, method: string) =>
    r.host.calls.filter((c) => c.method === method).length;

  it('a Settings stop cannot end a preview the Record page owns', () => {
    const r = rig();
    r.controller.startPreview('d1', 'record');
    r.controller.stopPreview('settings');
    expect(previewCalls(r, 'previewStop')).toBe(0);
    expect(r.controller.previewState).toEqual({ owner: 'record', deviceId: 'd1' });
  });

  it('a Settings start does not take the meter from Record', () => {
    const r = rig();
    r.controller.startPreview('d1', 'record');
    r.controller.startPreview('d2', 'settings');
    expect(previewCalls(r, 'previewStart')).toBe(1);
    expect(r.controller.previewState?.deviceId).toBe('d1');
  });

  it('the owner stops its own preview, and a stop without an owner forces it', () => {
    const r = rig();
    r.controller.startPreview('d1', 'record');
    r.controller.stopPreview('record');
    expect(previewCalls(r, 'previewStop')).toBe(1);
    expect(r.controller.previewState).toBeNull();
    r.controller.startPreview('d1', 'record');
    r.controller.stopPreview();
    expect(previewCalls(r, 'previewStop')).toBe(2);
  });

  it('Settings can start and stop its own preview', () => {
    const r = rig();
    r.controller.startPreview('d1');
    r.controller.stopPreview('settings');
    expect(previewCalls(r, 'previewStart')).toBe(1);
    expect(previewCalls(r, 'previewStop')).toBe(1);
  });
});
