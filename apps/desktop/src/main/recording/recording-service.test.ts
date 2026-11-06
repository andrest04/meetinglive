import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AudioRpcCall } from '@vozella/contracts';
import {
  CancelledError,
  FakeOfflineTranscriber,
  InMemorySettingsStore,
  RecordingPipeline,
  ScriptedMeetingStore,
  SummaryStage,
  Workspace,
  rememberAppPatch,
  rememberMicrophonePatch,
  type CancelSignal,
  type Logger,
} from '@vozella/core';
import { JsonSettingsStore, YtDlpError, YtDlpInstallError } from '@vozella/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioController, type AudioHostLike } from '../audio/audio-controller';
import { RecordingTakes } from '../audio/recording-take';
import type { AudioPushEvent } from '../workers/audio-worker-host';
import { RecordingService } from './recording-service';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const TRANSCRIPT = '[00:04.00-00:06.00] hello\n[00:06.00-00:08.00] world';

const app = (processId: number, friendlyName: string) => ({
  processId,
  exePath: `C:\\Apps\\${friendlyName}.exe`,
  friendlyName,
  isBrowser: false,
  isKnownMeetingApp: true,
  peak: 0.2,
});

/** The audio worker as the controller sees it: a recording creates the WAV like the real one. */
class FakeHost implements AudioHostLike {
  calls: AudioRpcCall[] = [];
  listeners = new Set<(e: AudioPushEvent) => void>();
  apps = [app(7, 'Zoom')];
  processAlive = true;
  failStart: Error | null = null;
  failStop: Error | null = null;
  failImport: Error | null = null;
  /** Runs while the capture starts, e.g. to push a failure event. */
  duringStart: (() => void) | null = null;

  call<T>(call: AudioRpcCall): Promise<T> {
    this.calls.push(call);
    switch (call.method) {
      case 'appsRefresh':
        return Promise.resolve(this.apps as T);
      case 'appsPeaks':
        return Promise.resolve([] as T);
      case 'listMicrophones':
        return Promise.resolve([{ id: 'mic-1', name: 'Mic one' }] as T);
      case 'getProcess':
        return Promise.resolve(
          (this.processAlive ? { processId: 7, exePath: 'C:\\Apps\\Zoom.exe' } : null) as T,
        );
      case 'recordStart':
        fs.writeFileSync(call.path, 'RIFF');
        this.duringStart?.();
        return this.failStart ? Promise.reject(this.failStart) : Promise.resolve(null as T);
      case 'importAudio':
        fs.writeFileSync(call.destination, 'RIFF');
        return this.failImport ? Promise.reject(this.failImport) : Promise.resolve(null as T);
      case 'recordStop':
        return this.failStop ? Promise.reject(this.failStop) : Promise.resolve(null as T);
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

/** yt-dlp as the service sees it: the download writes a real file into the work folder. */
class FakeYouTube {
  calls: string[] = [];
  ensureError: Error | null = null;
  downloadError: Error | null = null;
  /** Holds the download until the cancel fires, then rejects like the real downloader. */
  holdUntilCancel = false;
  /** Runs while the download is in flight. */
  duringDownload: (() => void) | null = null;
  workRoot = '';

  ensure(_cancel: CancelSignal): Promise<string> {
    this.calls.push('ensure');
    return this.ensureError ? Promise.reject(this.ensureError) : Promise.resolve('yt-dlp.exe');
  }
  update(): Promise<void> {
    this.calls.push('update');
    return Promise.resolve();
  }
  async download(url: string, directory: string, cancel: CancelSignal): Promise<string> {
    this.calls.push(`download:${url}`);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'abc.m4a');
    fs.writeFileSync(file, 'm4a');
    this.duringDownload?.();
    if (this.holdUntilCancel) {
      await new Promise<void>((resolve) => cancel.onCancel(resolve));
      throw new CancelledError();
    }
    if (this.downloadError) throw this.downloadError;
    return file;
  }
  workDirectory(meetingId: string): string {
    return path.join(this.workRoot, meetingId);
  }
  removeDirectory(directory: string): void {
    this.calls.push('removeDirectory');
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

let root: string;
let now: number;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-recording-'));
  now = new Date(2026, 10, 3, 10, 0, 0).getTime();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

interface Options {
  folders?: Record<string, string>;
  transcript?: string;
  liveStartFails?: boolean;
  liveDraft?: string | null;
  providerReady?: boolean;
  fileTimeMs?: number | null;
  ownsMarkdown?: (meetingId: string, markdownPath: string) => boolean;
  onRecordingStarted?: () => void;
}

function build(options: Options = {}) {
  const savedTitle: { value: string | null } = { value: null };
  const host = new FakeHost();
  const settings = new InMemorySettingsStore();
  void settings.update({
    selectedSummaryProvider: 'ClaudeCode',
    liveTranscriptionEnabled: true,
  });
  const folders: Record<string, string> = { ...options.folders };
  const events: { name: string; payload: unknown }[] = [];
  const broadcast = (channel: { name: string }, payload: unknown): void => {
    events.push({ name: channel.name, payload });
  };
  const controller = new AudioController({
    host,
    settings,
    broadcast,
    logger,
    scheduler: { every: () => () => undefined },
  });
  const liveListeners = new Set<(text: string, committed: string) => void>();
  const liveAskCalls: string[] = [];
  const order: string[] = [];
  const live = {
    start: vi.fn((_at: number) => {
      if (options.liveStartFails) return Promise.reject(new Error('model missing'));
      return Promise.resolve(undefined);
    }),
    stop: vi.fn(() => Promise.resolve(options.liveDraft ?? null)),
  };
  const inbox = path.join(root, 'Inbox');
  const takes = new RecordingTakes({
    controller,
    inboxDirectory: () => inbox,
    nowMs: () => now,
    wavDurationSeconds: () => 30,
    logger,
    live,
  });
  const store = new ScriptedMeetingStore();
  const transcriber = new FakeOfflineTranscriber({ result: options.transcript ?? TRANSCRIPT });
  const summary = new SummaryStage({
    settings,
    resolver: {
      resolveSummaryProvider: () => Promise.resolve({ status: 'needs-setup' } as never),
    },
    generator: { generate: vi.fn() },
    translate: (key) => key,
  });
  const pipeline = new RecordingPipeline({
    meetings: store,
    settings,
    transcriber,
    formatFailure: (e) => (e instanceof Error ? e.message : String(e)),
    summary,
  });
  const workspace = new Workspace();
  const repaired: string[] = [];
  const youtube = new FakeYouTube();
  youtube.workRoot = path.join(root, 'youtube');
  const service = new RecordingService({
    onRecordingStarted: options.onRecordingStarted,
    liveAsk: {
      reset: () => {
        order.push('liveAsk.reset');
        liveAskCalls.push('reset');
      },
      cancel: () => liveAskCalls.push('cancel'),
      committed: (text) => liveAskCalls.push(`committed:${text}`),
    },
    takes,
    controller,
    library: {
      audioDirectory: (folderId) =>
        Promise.resolve(
          folderId !== null && folders[folderId] !== undefined
            ? path.join(root, folders[folderId])
            : inbox,
        ),
      folderExists: (id) => Promise.resolve(folders[id] !== undefined),
      ownsMarkdown: (id, p) => Promise.resolve(options.ownsMarkdown?.(id, p) ?? false),
    },
    files: {
      remove: (file) => {
        fs.rmSync(file, { force: true });
      },
      repair: (file) => {
        repaired.push(file);
      },
      fileTimeMs: () => (options.fileTimeMs === undefined ? 1_000_000 : options.fileTimeMs),
      wavDurationSeconds: () => 30,
    },
    settings,
    setup: {
      loadSettings: () => settings.load(),
      localModelFileExists: () => Promise.resolve(false),
      cliOnPath: () => Promise.resolve(options.providerReady ?? true),
      engineReady: () => Promise.resolve(true),
    },
    pipeline,
    workspace,
    live: {
      onUpdate: (listener) => {
        liveListeners.add(listener);
        return () => liveListeners.delete(listener);
      },
    },
    broadcast,
    logger,
    nowMs: () => now,
    newId: () => 'meeting-1',
    schedule: () => () => undefined,
    defaultTitle: () => 'Meeting 3 Nov, 10:00',
    meetingTitle: () => Promise.resolve(savedTitle.value),
    youtube,
  });
  return {
    youtube,
    host,
    settings,
    controller,
    takes,
    live,
    liveListeners,
    liveAskCalls,
    order,
    store,
    transcriber,
    service,
    savedTitle,
    workspace,
    events,
    repaired,
    inbox,
    folders,
  };
}

const sources = {
  title: 'Standup',
  folderId: null,
  microphone: { kind: 'SystemDefault' as const, deviceId: null },
  processId: null,
  appName: null,
};

describe('RecordingService start', () => {
  it('records into the dated stem of the destination folder and publishes the state', async () => {
    const t = build({ folders: { f1: 'Clients' } });
    const result = await t.service.start({ ...sources, folderId: 'f1' });
    expect(result).toMatchObject({ started: true, meetingId: 'meeting-1' });
    const state = t.service.getState();
    expect(state).toMatchObject({ phase: 'Recording', isRecording: true, isPaused: false });
    expect(state.status).toEqual([{ key: 'Status_Recording', args: [], severity: 'info' }]);
    const wav = path.join(root, 'Clients', '2026-11-03 Standup.wav');
    expect(fs.existsSync(wav)).toBe(true);
    expect(t.events.some((e) => e.name === 'recording.state')).toBe(true);
  });

  it('refuses a second start while a take holds the session', async () => {
    const t = build();
    await t.service.start(sources);
    expect(await t.service.start(sources)).toMatchObject({ started: false, reason: 'busy' });
  });

  it('does not record when the setup gate says no, and says nothing about it', async () => {
    const t = build({ providerReady: false });
    const result = await t.service.start(sources);
    expect(result).toEqual({ started: false, reason: 'not-ready', message: null });
    expect(t.host.methods()).not.toContain('recordStart');
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('B-4: recordedAt is the instant the capture started, after the model loaded', async () => {
    const t = build();
    t.live.start.mockImplementation(() => {
      now += 4000; // the model takes four seconds to load
      return Promise.resolve(undefined);
    });
    const startedAt = now;
    const result = await t.service.start(sources);
    expect(result).toMatchObject({ started: true, recordedAtMs: startedAt + 4000 });
  });

  it('shows that the model is loading while the live session starts', async () => {
    const t = build();
    let statusDuringLoad: unknown;
    t.live.start.mockImplementation(() => {
      statusDuringLoad = t.service.getState().status[0]?.key;
      return Promise.resolve(undefined);
    });
    await t.service.start(sources);
    expect(statusDuringLoad).toBe('Status_LoadingModel');
  });

  it('uses the app name in the recording status', async () => {
    const t = build();
    await t.controller.startSources();
    const result = await t.service.start({ ...sources, processId: 7, appName: 'Zoom' });
    expect(result.started).toBe(true);
    expect(t.service.getState().status[0]).toMatchObject({
      key: 'Status_RecordingMicApp',
      args: ['Zoom'],
    });
  });

  it('48, 49: an app that is gone falls back to system audio with a notice', async () => {
    const t = build();
    await t.controller.startSources();
    await t.controller.select(7);
    t.host.processAlive = false;
    await t.service.start({ ...sources, processId: 7, appName: 'Zoom' });
    const state = t.service.getState();
    expect(state.status[0]?.key).toBe('Status_Recording');
    expect(state.captureNotices).toEqual([
      { key: 'RecordPage_SourceFallbackMessage', args: ['Zoom'], severity: 'warning' },
    ]);
  });

  it('B-23: a start that never loaded the sources restores the remembered microphone and app', async () => {
    const t = build();
    await t.settings.update({
      ...rememberMicrophonePatch({ kind: 'Device', deviceId: 'mic-1' }),
      ...rememberAppPatch('C:\\Apps\\Zoom.exe', 'Zoom'),
    });
    const result = await t.service.start({
      title: 'Pill',
      folderId: null,
      microphone: null,
      appName: null,
    });
    expect(result.started).toBe(true);
    const start = t.host.calls.find((c) => c.method === 'recordStart');
    expect(start).toMatchObject({
      sources: { captureMicrophone: true, microphoneDeviceId: 'mic-1' },
    });
    expect(t.service.getState().status[0]).toMatchObject({ args: ['Zoom'] });
  });
});

describe('RecordingService start failure', () => {
  it('59, B-2: deletes the partial WAV, says so, and leaves the gate idle', async () => {
    const t = build();
    t.host.failStart = new Error('device busy');
    const result = await t.service.start(sources);
    expect(result).toMatchObject({
      started: false,
      reason: 'failed',
      message: { key: 'Error_StartRecording', args: ['device busy'], severity: 'error' },
    });
    expect(fs.readdirSync(t.inbox)).toEqual([]);
    expect(t.service.gate.phase).toBe('Idle');
    expect(t.service.getState().status[0]?.key).toBe('Error_StartRecording');
  });

  it('B-29: a live session that failed midway is stopped', async () => {
    const t = build({ liveStartFails: true });
    const result = await t.service.start(sources);
    expect(result).toMatchObject({ started: false, reason: 'failed' });
    expect(t.live.stop).toHaveBeenCalledTimes(1);
    expect(t.host.methods()).not.toContain('recordStart');
  });

  it('57: the idle preview stops before the capture and comes back after a failed start', async () => {
    const t = build();
    t.controller.startPreview('mic-1', 'record');
    t.host.failStart = new Error('nope');
    await t.service.start(sources);
    const methods = t.host.methods();
    expect(methods.indexOf('previewStop')).toBeLessThan(methods.indexOf('recordStart'));
    expect(t.host.calls.filter((c) => c.method === 'previewStart')).toHaveLength(2);
    expect(t.controller.previewState).toEqual({ owner: 'record', deviceId: 'mic-1' });
  });

  it('58: the capture event subscription is removed after a failed start', async () => {
    const t = build();
    t.host.failStart = new Error('nope');
    await t.service.start(sources);
    t.host.push({ type: 'faulted', message: 'late' });
    expect(t.service.getState().captureNotices).toEqual([]);
  });

  it('52: the start steps run in the order of the C# sequence', async () => {
    const t = build();
    const spy = <T extends object>(target: T, key: keyof T & string, label: string): void => {
      const original = (target as Record<string, (...a: unknown[]) => unknown>)[key]!;
      vi.spyOn(target as Record<string, (...a: unknown[]) => unknown>, key).mockImplementation(
        (...args: unknown[]) => {
          t.order.push(label);
          return original.apply(target, args);
        },
      );
    };
    spy(t.controller, 'loadMicrophones', 'mic.load');
    spy(t.controller, 'startSources', 'sources');
    spy(t.settings, 'load', 'settings.load');
    spy(t.controller, 'stopPreview', 'preview.stop');
    t.live.start.mockImplementation(() => {
      t.order.push(
        t.service.getState().status[0]?.key === 'Status_LoadingModel'
          ? 'live.start(loading)'
          : 'live.start(no status)',
      );
      return Promise.resolve(undefined);
    });
    t.host.duringStart = () => {
      t.order.push('capture.start');
    };
    await t.service.start({ ...sources, microphone: null, processId: undefined });
    const steps = t.order;
    const at = (x: string): number => steps.indexOf(x);
    expect(at('mic.load')).toBeGreaterThanOrEqual(0);
    expect(at('mic.load')).toBeLessThan(at('sources'));
    expect(at('sources')).toBeLessThan(steps.lastIndexOf('settings.load'));
    expect(steps.lastIndexOf('settings.load')).toBeLessThan(at('liveAsk.reset'));
    expect(at('liveAsk.reset')).toBeLessThan(at('live.start(loading)'));
    // The port stops the idle meter before the live model loads (spec step 10 comes after 9).
    expect(at('live.start(loading)')).toBeGreaterThan(at('preview.stop'));
    expect(at('live.start(loading)')).toBeLessThan(at('capture.start'));
  });

  it('53: a linked meeting id is the id of the take and of the saved record', async () => {
    const t = build();
    const result = await t.service.start(sources, { meetingId: 'linked' });
    expect(result).toMatchObject({ started: true, meetingId: 'linked' });
    expect(t.service.getState().meetingId).toBe('linked');
    await t.service.stop();
    await t.service.completion;
    expect(t.store.saves.length).toBeGreaterThan(0);
    expect(t.store.saves.every((r) => r.id === 'linked')).toBe(true);
  });

  it('B-9: the path allocator asks the library about the take own meeting id', async () => {
    const owned: string[] = [];
    const t = build({
      ownsMarkdown: (id, p) => {
        owned.push(`${id}|${path.basename(p)}`);
        return id === 'meeting-1';
      },
    });
    fs.mkdirSync(t.inbox, { recursive: true });
    fs.writeFileSync(path.join(t.inbox, '2026-11-03 Standup.md'), '# x');
    await t.service.start(sources);
    expect(owned).toEqual(['meeting-1|2026-11-03 Standup.md']);
    expect(fs.existsSync(path.join(t.inbox, '2026-11-03 Standup.wav'))).toBe(true);
  });

  it('58: no capture event reaches the state after a stop or a discard', async () => {
    const stopped = build();
    await stopped.service.start(sources);
    await stopped.service.stop();
    await stopped.service.completion;
    const before = stopped.service.getState().captureNotices;
    stopped.host.push({ type: 'faulted', message: 'late after stop' });
    expect(stopped.service.getState().captureNotices).toEqual(before);

    const discarded = build();
    await discarded.service.start(sources);
    await discarded.service.discard();
    discarded.host.push({ type: 'faulted', message: 'late after discard' });
    expect(discarded.service.getState().captureNotices).toEqual([]);
  });

  it('97, B-24: a soft warning raised during the take is a warning status entry after Done', async () => {
    const t = build();
    await t.service.start(sources);
    t.host.push({ type: 'source-lost', source: 'Microphone', remaining: 1, message: 'gone' });
    expect(t.service.getState().microphoneActive).toBe(true);
    await t.service.stop();
    await t.service.completion;
    const status = t.service.getState().status;
    expect(status[status.length - 1]).toMatchObject({
      key: 'Warning_MicrophoneLost',
      severity: 'warning',
    });
  });

  it('182: the main window is handed off once, when the recording starts, not on pause or stop', async () => {
    const started = vi.fn();
    const t = build({ onRecordingStarted: started });
    await t.service.start(sources);
    expect(started).toHaveBeenCalledTimes(1);
    await t.service.pause();
    await t.service.resume();
    await t.service.stop();
    await t.service.completion;
    expect(started).toHaveBeenCalledTimes(1);
  });

  it('182: a failed start does not hand the window off', async () => {
    const started = vi.fn();
    const t = build({ onRecordingStarted: started });
    t.host.failStart = new Error('nope');
    await t.service.start(sources);
    expect(started).not.toHaveBeenCalled();
  });

  it('108: a late live update outside a take does not change the transcript text', async () => {
    const t = build();
    await t.service.start(sources);
    await t.service.stop();
    await t.service.completion;
    const before = t.service.getState().liveText;
    for (const listener of t.liveListeners) listener('[00:00.00-00:01.00] too late', 'too late');
    expect(t.service.getState().liveText).toBe(before);
    expect(t.liveAskCalls).not.toContain('committed:too late');
  });

  it('60: a failure between capture start and the recording mark stops the take at once', async () => {
    const t = build();
    t.host.duringStart = () => {
      t.host.push({ type: 'faulted', message: 'device lost' });
    };
    const result = await t.service.start(sources);
    expect(result.started).toBe(true);
    await t.service.completion;
    expect(t.host.methods()).toContain('recordStop');
    const state = t.service.getState();
    expect(state.phase).toBe('Idle');
    expect(state.status[0]).toEqual({
      key: 'Error_CaptureFaulted',
      args: ['device lost'],
      severity: 'error',
    });
    expect(t.store.saves.length).toBeGreaterThan(0);
  });
});

describe('RecordingService pause and highlights', () => {
  it('65 to 67, 69: highlights are in WAV time, the pause is not counted', async () => {
    const t = build();
    await t.service.start(sources);
    now += 5000;
    expect(t.service.highlight()).toEqual({ marked: true, elapsedMs: 5000 });
    now += 1000;
    await t.service.pause();
    expect(t.service.getState()).toMatchObject({
      isPaused: true,
      isTicking: false,
      elapsedMs: 6000,
    });
    expect(t.service.getState().status[0]?.key).toBe('Status_Paused');
    now += 10_000;
    expect(t.service.highlight().elapsedMs).toBe(6000);
    await t.service.resume();
    now += 1000;
    expect(t.service.highlight().elapsedMs).toBe(7000);
    expect(t.service.getState().status[0]?.key).toBe('Status_Recording');

    await t.service.stop();
    await t.service.completion;
    expect(t.transcriber.calls[0]?.clockSkewMs).toBe(10_000);
    const saved = t.store.saves.at(-1);
    expect(saved?.transcript).toContain('* [00:04.00-00:06.00] hello');
    expect(saved?.transcript).toContain('* [00:06.00-00:08.00] world');
  });

  it('refuses pause and highlight when nothing records', async () => {
    const t = build();
    expect(await t.service.pause()).toBe(false);
    expect(t.service.highlight().marked).toBe(false);
  });

  it('B-15: the level meter reads zero while paused', async () => {
    const t = build();
    await t.service.start(sources);
    t.host.push({ type: 'recording-level', level: 60 });
    expect(t.service.getState().micLevel).toBe(60);
    await t.service.pause();
    t.host.push({ type: 'recording-level', level: 60 });
    expect(t.service.getState().micLevel).toBe(0);
  });

  it('B-22, 110: the canvas stars the live text; the chat gets the plain transcript', async () => {
    const t = build();
    await t.service.start(sources);
    for (const listener of t.liveListeners) listener(TRANSCRIPT, TRANSCRIPT);
    now += 5000;
    t.service.highlight();
    const pushes = t.events.filter((e) => e.name === 'recording.liveText');
    expect((pushes.at(-1)?.payload as { text: string }).text).toContain(
      '* [00:04.00-00:06.00] hello',
    );
    expect(t.workspace.state.liveTranscript).toBe(TRANSCRIPT);
  });
});

describe('RecordingService live ask hooks (127)', () => {
  it('resets at Start, forwards committed text, and cancels on Stop and on Discard', async () => {
    const t = build();
    await t.service.start(sources);
    expect(t.liveAskCalls).toEqual(['reset']);
    expect(t.service.liveAskContext).toEqual({ recording: true, title: 'Standup' });
    for (const listener of t.liveListeners) listener('shown', 'committed text');
    expect(t.liveAskCalls).toContain('committed:committed text');
    await t.service.stop();
    expect(t.liveAskCalls.at(-1)).toBe('cancel');
    expect(t.service.liveAskContext.recording).toBe(false);

    const d = build();
    await d.service.start(sources);
    await d.service.discard();
    expect(d.liveAskCalls).toEqual(['reset', 'cancel']);
  });
});

describe('RecordingService stop', () => {
  it('74, 77, 78: saves the meeting with the title, folder and audio of the take', async () => {
    const t = build({ folders: { f1: 'Clients' }, liveDraft: '[00:00.00-00:01.00] live' });
    await t.service.start({ ...sources, folderId: 'f1' });
    now += 30_000;
    const stopped = t.service.stop();
    expect(t.service.getState().isRecording).toBe(true);
    await stopped;
    expect(t.service.getState()).toMatchObject({ phase: 'Processing', isProcessing: true });
    await t.service.completion;
    const saved = t.store.saves[0];
    expect(saved).toMatchObject({ id: 'meeting-1', title: 'Standup', folderId: 'f1' });
    expect(saved?.audioFilePath).toBe(path.join(root, 'Clients', '2026-11-03 Standup.wav'));
    const state = t.service.getState();
    expect(state.phase).toBe('Idle');
    expect(state.lastMeeting).toMatchObject({ id: 'meeting-1' });
    expect(t.repaired).toContain(saved?.audioFilePath);
    expect(t.workspace.state.lastProcessedMeetingId).toBe('meeting-1');
  });

  it('the result card follows a title the summary replaced after the meeting was saved', async () => {
    const t = build();
    await t.service.start(sources);
    await t.service.stop();
    t.savedTitle.value = 'Fake planning meeting';
    await t.service.completion;
    await t.service.refreshLastTitle('meeting-1');
    expect(t.service.getState().lastMeeting?.title).toBe('Fake planning meeting');
  });

  it('162: the last meeting is forgotten when it is deleted', async () => {
    const t = build();
    await t.service.start(sources);
    await t.service.stop();
    await t.service.completion;
    expect(t.service.getState().lastMeeting).toMatchObject({ id: 'meeting-1' });
    t.service.forgetMeeting('other');
    expect(t.service.getState().lastMeeting).not.toBeNull();
    t.service.forgetMeeting('meeting-1');
    expect(t.service.getState().lastMeeting).toBeNull();
    expect(t.service.getState().liveText).toBe('');
  });

  it('190: a destination folder deleted during the take files the meeting in the Inbox', async () => {
    const t = build({ folders: { f1: 'Clients' } });
    await t.service.start({ ...sources, folderId: 'f1' });
    delete t.folders.f1;
    await t.service.stop();
    await t.service.completion;
    expect(t.store.saves[0]?.folderId).toBeNull();
  });

  it('74: a second stop joins the one that runs; the capture stops once', async () => {
    const t = build();
    await t.service.start(sources);
    const first = t.service.stop();
    const second = t.service.stop();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    await t.service.completion;
    expect(t.host.methods().filter((m) => m === 'recordStop')).toHaveLength(1);
    expect(t.store.saves.length).toBeGreaterThan(0);
    expect(await t.service.stop()).toBe(false);
  });

  it('75: a stop error is reported', async () => {
    const t = build();
    t.host.failStop = new Error('writer closed');
    await t.service.start(sources);
    await t.service.stop();
    expect(t.service.getState().status.map((m) => m.key)).toContain('Error_StopRecording');
    await t.service.completion;
  });

  it('75, B-30: a stop error never replaces a capture failure that was already notified', async () => {
    const t = build();
    t.host.failStop = new Error('writer closed');
    await t.service.start(sources);
    t.host.push({ type: 'faulted', message: 'device lost' });
    await t.service.completion;
    const keys = t.service.getState().status.map((m) => m.key);
    expect(keys[0]).toBe('Error_CaptureFaulted');
    expect(keys).not.toContain('Error_StopRecording');
  });

  it('94: a hard failure stops the take once and keeps the audio', async () => {
    const t = build();
    await t.service.start(sources);
    t.host.push({ type: 'output-failed', message: 'loopback gone' });
    t.host.push({ type: 'faulted', message: 'again' });
    await t.service.completion;
    expect(t.host.methods().filter((m) => m === 'recordStop')).toHaveLength(1);
    const state = t.service.getState();
    expect(state.captureNotices).toHaveLength(1);
    expect(state.captureNotices[0]).toMatchObject({
      key: 'Error_OutputCaptureFailed',
      severity: 'error',
    });
    expect(t.store.saves[0]?.audioFilePath).toMatch(/\.wav$/);
  });

  it('76: when the live pass gives no draft the visible text is kept', async () => {
    const t = build({ liveDraft: null });
    t.transcriber.script.ready = false;
    await t.service.start(sources);
    for (const listener of t.liveListeners) listener('[00:00.00-00:01.00] on screen', '');
    await t.service.stop();
    await t.service.completion;
    expect(t.store.saves[0]?.transcript).toContain('on screen');
  });
});

describe('RecordingService discard', () => {
  it('72, 73: deletes the WAV, saves nothing, and says it was discarded', async () => {
    const t = build();
    await t.service.start(sources);
    const wav = path.join(t.inbox, '2026-11-03 Standup.wav');
    expect(fs.existsSync(wav)).toBe(true);
    expect(await t.service.discard()).toBe(true);
    expect(fs.existsSync(wav)).toBe(false);
    expect(t.store.saves).toEqual([]);
    const state = t.service.getState();
    expect(state.phase).toBe('Idle');
    expect(state.status).toEqual([
      { key: 'Status_RecordingDiscarded', args: [], severity: 'info' },
    ]);
    expect(state.meetingId).toBeNull();
    expect(state.lastMeeting).toBeNull();
    expect(t.live.stop).toHaveBeenCalled();
  });

  it('never touches a linked meeting', async () => {
    const t = build();
    await t.service.start(sources, { meetingId: 'linked' });
    await t.service.discard();
    expect(t.store.saves).toEqual([]);
    expect(t.service.runs.currentMeetingId).toBeNull();
  });

  it('refuses when nothing records', async () => {
    expect(await build().service.discard()).toBe(false);
  });
});

describe('RecordingService notes', () => {
  it('130, 131: notes live in main, are saved trimmed, and refused while idle', async () => {
    const t = build();
    expect(t.service.setNotes('before')).toBe(false);
    await t.service.start(sources);
    t.service.setNotes('  decide the date  \n');
    expect(t.service.getState().notes).toBe('  decide the date  \n');
    await t.service.stop();
    await t.service.completion;
    expect(t.store.saves[0]?.notes).toBe('decide the date');
  });

  it('saves null notes when they are blank', async () => {
    const t = build();
    await t.service.start(sources);
    t.service.setNotes('   ');
    await t.service.stop();
    await t.service.completion;
    expect(t.store.saves[0]?.notes).toBeNull();
  });

  it('B-10: notes of one take never reach the next one', async () => {
    const t = build();
    await t.service.start(sources);
    t.service.setNotes('first take');
    await t.service.stop();
    await t.service.completion;
    expect(t.service.getState().notes).toBe('');
    now += 60_000;
    await t.service.start({ ...sources, title: 'Second' });
    expect(t.service.getState().notes).toBe('');
    t.service.setNotes('second take');
    await t.service.discard();
    expect(t.service.getState().notes).toBe('');
  });
});

describe('RecordingService retry', () => {
  it('B-11: a failed first save can be processed again from the same audio', async () => {
    const t = build({ liveDraft: null });
    t.store.failSaves = new Set([1]);
    t.transcriber.script.ready = false;
    await t.service.start(sources);
    await t.service.stop();
    await t.service.completion;
    expect(t.service.getState().canRetry).toBe(true);
    t.transcriber.script.ready = true;
    expect(t.service.retryProcessing()).toBe(true);
    await t.service.completion;
    expect(t.service.getState().canRetry).toBe(false);
    expect(t.store.records.get('meeting-1')?.transcript).toContain('hello');
  });

  it('B-11: the retried meeting keeps the notes typed during the take', async () => {
    const t = build({ liveDraft: null });
    t.store.failSaves = new Set([1]);
    t.transcriber.script.ready = false;
    await t.service.start(sources);
    t.service.setNotes('decide the date');
    await t.service.stop();
    await t.service.completion;
    t.transcriber.script.ready = true;
    expect(t.service.retryProcessing()).toBe(true);
    await t.service.completion;
    expect(t.store.saves.at(-1)?.notes).toBe('decide the date');
  });

  it('139: a take that ends because the engine is missing reads as an error', async () => {
    const t = build({ liveDraft: null });
    t.transcriber.script.ready = false;
    await t.service.start(sources);
    await t.service.stop();
    await t.service.completion;
    expect(t.service.getState().status).toContainEqual(
      expect.objectContaining({ key: 'Ui_TranscriptionEngineUnavailable', severity: 'error' }),
    );
  });

  it('refuses a retry when there is nothing to retry', () => {
    expect(build().service.retryProcessing()).toBe(false);
  });
});

describe('settings writes (B-31)', () => {
  it('186: concurrent remember patches all reach the file', async () => {
    const store = new JsonSettingsStore({
      settingsFilePath: path.join(root, 'settings.json'),
    });
    await Promise.all([
      store.update(rememberMicrophonePatch({ kind: 'Device', deviceId: 'mic-9' })),
      store.update(rememberAppPatch('C:\\Apps\\Zoom.exe', 'Zoom')),
      store.update({ liveTranscriptionEnabled: false }),
    ]);
    const loaded = await store.load();
    expect(loaded).toMatchObject({
      recordMicrophoneKind: 'Device',
      recordMicrophoneDeviceId: 'mic-9',
      recordAppExePath: 'C:\\Apps\\Zoom.exe',
      liveTranscriptionEnabled: false,
    });
  });
});

describe('RecordingService import (2.12)', () => {
  const picked = { title: 'Call', folderId: null, path: 'C:/in/call.mp3' };

  it('170 to 173, B-19: converts at the dated stem, ends at the file time, runs the pipeline', async () => {
    const t = build({ fileTimeMs: 2_000_000 });
    const result = await t.service.importAudio(picked);
    expect(result).toEqual({ started: true, meetingId: 'meeting-1' });
    expect(t.service.getState().status[0]).toMatchObject({ key: 'Status_Importing' });
    await t.service.completion;
    const call = t.host.calls.find((c) => c.method === 'importAudio');
    expect(call).toMatchObject({ source: 'C:/in/call.mp3' });
    const saved = t.store.saves.at(-1);
    expect(saved?.audioFilePath).toMatch(/Call\.wav$/);
    // The file time is the end, 30 s of audio before it is the start (B-19).
    expect(Date.parse(saved?.recordedAt ?? '')).toBe(2_000_000 - 30_000);
    expect(Date.parse(saved?.endedAt ?? '')).toBe(2_000_000);
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('173: the idle preview stops for the import and comes back after a failure', async () => {
    const t = build();
    t.controller.startPreview('mic-1', 'record');
    t.host.failImport = new Error('unsupported codec');
    await t.service.importAudio(picked);
    const methods = t.host.methods();
    expect(methods.indexOf('previewStop')).toBeGreaterThanOrEqual(0);
    expect(methods.indexOf('previewStop')).toBeLessThan(methods.indexOf('importAudio'));
    expect(t.controller.previewState).toEqual({ owner: 'record', deviceId: 'mic-1' });
  });

  it('172: no live draft, no highlights and no paused time reach the pipeline', async () => {
    const t = build();
    t.service.setNotes('stale');
    await t.service.importAudio(picked);
    await t.service.completion;
    const saved = t.store.saves.at(-1);
    expect(saved?.transcript).toContain('hello');
    expect(t.live.start).not.toHaveBeenCalled();
    expect(t.service.getState().notes).toBe('');
  });

  it('171: a conversion failure removes the partial WAV and shows Error_ImportAudio', async () => {
    const t = build();
    t.host.failImport = new Error('unsupported codec');
    const result = await t.service.importAudio(picked);
    expect(result).toMatchObject({
      started: false,
      reason: 'failed',
      message: { key: 'Error_ImportAudio', args: ['unsupported codec'], severity: 'error' },
    });
    expect(fs.existsSync(t.inbox) ? fs.readdirSync(t.inbox) : []).toEqual([]);
    expect(t.service.gate.phase).toBe('Idle');
    expect(t.service.getState().status[0]).toMatchObject({ key: 'Error_ImportAudio' });
  });

  it('170: cancel during the conversion stops it and cleans up without an error', async () => {
    const t = build();
    let release: () => void = () => undefined;
    const original = t.host.call.bind(t.host);
    t.host.call = (call: { method: string }) => {
      if (call.method === 'importAudio') {
        return new Promise<never>((_resolve, reject) => {
          release = () => {
            reject(new Error('aborted'));
          };
        });
      }
      return original(call as never);
    };
    const running = t.service.importAudio(picked);
    await vi.waitFor(() => {
      expect(t.service.cancelProcessing(null)).toBe(true);
    });
    release();
    expect(await running).toMatchObject({ started: false, reason: 'cancelled' });
    expect(t.host.methods()).toContain('importCancel');
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('refuses while a take holds the session, and when the setup gate says no', async () => {
    const busy = build();
    await busy.service.start(sources);
    expect(await busy.service.importAudio(picked)).toMatchObject({ reason: 'busy' });
    const notReady = build({ providerReady: false });
    expect(await notReady.service.importAudio(picked)).toEqual({
      started: false,
      reason: 'not-ready',
      message: null,
    });
    expect(notReady.host.methods()).not.toContain('importAudio');
  });
});

describe('RecordingService import from YouTube', () => {
  const link = { title: 'Talk', folderId: null, url: 'https://youtu.be/dQw4w9WgXcQ' };
  const canonical = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const workFolder = (): string => path.join(root, 'youtube', 'meeting-1');

  it('rejects a link that is not a YouTube video without downloading anything', async () => {
    const t = build();
    const result = await t.service.importUrl({ ...link, url: 'https://example.com/v' });
    expect(result).toEqual({
      started: false,
      reason: 'failed',
      message: { key: 'Ui_ErrorYouTubeUrl', args: [], severity: 'error' },
    });
    expect(t.youtube.calls).toEqual([]);
    expect(t.host.methods()).not.toContain('importAudio');
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('installs, updates, downloads, then converts with no file time and runs the pipeline', async () => {
    const t = build();
    const statuses: string[] = [];
    t.youtube.duringDownload = () => {
      statuses.push(t.service.getState().status[0]?.key ?? '');
    };
    const result = await t.service.importUrl(link);
    expect(result).toEqual({ started: true, meetingId: 'meeting-1' });
    expect(statuses).toEqual(['Ui_StatusDownloadingYouTube']);
    expect(t.service.getState().status[0]).toMatchObject({ key: 'Status_Importing' });
    expect(t.youtube.calls).toEqual([
      'ensure',
      'update',
      `download:${canonical}`,
      'removeDirectory',
    ]);
    const call = t.host.calls.find((c) => c.method === 'importAudio');
    expect(call).toMatchObject({ source: path.join(workFolder(), 'abc.m4a') });
    await t.service.completion;
    const saved = t.store.saves.at(-1);
    expect(saved?.audioFilePath).toMatch(/Talk\.wav$/);
    // No file time: the import ends now and starts 30 s earlier.
    expect(Date.parse(saved?.endedAt ?? '')).toBe(now);
    expect(Date.parse(saved?.recordedAt ?? '')).toBe(now - 30_000);
    expect(fs.existsSync(workFolder())).toBe(false);
  });

  it('removes the temp folder when the conversion fails', async () => {
    const t = build();
    t.host.failImport = new Error('unsupported codec');
    const result = await t.service.importUrl(link);
    expect(result).toMatchObject({ started: false, reason: 'failed' });
    expect(fs.existsSync(workFolder())).toBe(false);
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('maps a yt-dlp failure to Ui_ErrorYouTubeDownload and removes the temp folder', async () => {
    const t = build();
    t.youtube.downloadError = new YtDlpError(1, 'WARNING: slow\nERROR: Video unavailable');
    const result = await t.service.importUrl(link);
    expect(result).toEqual({
      started: false,
      reason: 'failed',
      message: {
        key: 'Ui_ErrorYouTubeDownload',
        args: ['Video unavailable'],
        severity: 'error',
      },
    });
    expect(t.host.methods()).not.toContain('importAudio');
    expect(fs.existsSync(workFolder())).toBe(false);
    expect(t.service.getState().status[0]).toMatchObject({ key: 'Ui_ErrorYouTubeDownload' });
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('maps an install failure to Ui_ErrorYtDlpInstall without downloading', async () => {
    const t = build();
    t.youtube.ensureError = new YtDlpInstallError('checksum-mismatch', 'bad hash');
    const result = await t.service.importUrl(link);
    expect(result).toEqual({
      started: false,
      reason: 'failed',
      message: { key: 'Ui_ErrorYtDlpInstall', args: [], severity: 'error' },
    });
    expect(t.youtube.calls).not.toContain(`download:${canonical}`);
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('cancel during the download stops it, removes the temp folder and reports cancelled', async () => {
    const t = build();
    t.youtube.holdUntilCancel = true;
    const running = t.service.importUrl(link);
    await vi.waitFor(() => {
      expect(t.youtube.calls).toContain(`download:${canonical}`);
    });
    expect(t.service.cancelProcessing(null)).toBe(true);
    expect(await running).toMatchObject({
      started: false,
      reason: 'cancelled',
      message: { key: 'Status_ProcessingCancelled' },
    });
    expect(t.host.methods()).not.toContain('importAudio');
    expect(fs.existsSync(workFolder())).toBe(false);
    expect(t.service.gate.phase).toBe('Idle');
  });

  it('refuses while a take holds the session', async () => {
    const t = build();
    await t.service.start(sources);
    expect(await t.service.importUrl(link)).toMatchObject({ reason: 'busy' });
    expect(t.youtube.calls).toEqual([]);
  });
});

describe('RecordingService entry points and close state', () => {
  const request = {
    recordedAtMs: 1_000,
    endedAtMs: null,
    title: 'Old',
    liveDraft: null,
    pausedDurationMs: 0,
    folderId: null,
    highlightsMs: [],
  };

  it('processAudioFile re-runs the pipeline for a saved meeting and marks it in use', async () => {
    const t = build();
    const wav = path.join(root, 'old.wav');
    fs.writeFileSync(wav, 'RIFF');
    expect(t.service.processAudioFile('saved-1', wav, request)).toEqual({
      started: true,
      meetingId: 'saved-1',
    });
    expect(t.service.isMeetingInUse('saved-1')).toBe(true);
    expect(t.service.isCaptureActive).toBe(true);
    expect(t.service.processAudioFile('saved-2', wav, request)).toEqual({
      started: false,
      reason: 'busy',
    });
    await t.service.completion;
    expect(t.store.saves.at(-1)?.id).toBe('saved-1');
    expect(t.service.isCaptureActive).toBe(false);
  });

  it('165: recording requires confirmation, and an unfinished run is a pending save', async () => {
    const t = build();
    expect(t.service.requiresCloseConfirmation).toBe(false);
    expect(t.service.hasPendingSaves).toBe(false);
    await t.service.start(sources);
    expect(t.service.requiresCloseConfirmation).toBe(true);
    expect(await t.service.shutdown()).toBe(true);
    expect(t.service.requiresCloseConfirmation).toBe(false);
    expect(t.service.hasPendingSaves).toBe(false);
    expect(t.store.saves.length).toBeGreaterThan(0);
  });

  describe('close gate inputs per phase (RecordingSessionGateTests, 90 to 101)', () => {
    it('Idle: nothing to confirm and nothing pending', () => {
      const t = build();
      expect(t.service.gate.phase).toBe('Idle');
      expect([t.service.requiresCloseConfirmation, t.service.hasPendingSaves]).toEqual([
        false,
        false,
      ]);
    });

    it('Preparing: no confirmation, but pending (101)', () => {
      const t = build();
      t.service.gate.tryBeginPreparing();
      expect([t.service.requiresCloseConfirmation, t.service.hasPendingSaves]).toEqual([
        false,
        true,
      ]);
    });

    it('Recording: confirmation required', () => {
      const t = build();
      t.service.gate.tryBeginPreparing();
      t.service.gate.markRecording();
      expect(t.service.requiresCloseConfirmation).toBe(true);
    });

    it('Stopping: pending, no confirmation', () => {
      const t = build();
      t.service.gate.tryBeginPreparing();
      t.service.gate.markRecording();
      t.service.gate.tryBeginStopping();
      expect([t.service.requiresCloseConfirmation, t.service.hasPendingSaves]).toEqual([
        false,
        true,
      ]);
    });

    it('Processing: pending while the run has not saved and wound down', async () => {
      const t = build();
      const wav = path.join(root, 'p.wav');
      fs.writeFileSync(wav, 'RIFF');
      t.service.processAudioFile(null, wav, request);
      expect(t.service.gate.phase).toBe('Processing');
      expect([t.service.requiresCloseConfirmation, t.service.hasPendingSaves]).toEqual([
        false,
        true,
      ]);
      await t.service.completion;
      expect(t.service.hasPendingSaves).toBe(false);
    });
  });

  describe('101: closing during a start or an import does not abandon the take', () => {
    function holdCall(t: ReturnType<typeof build>, method: string) {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const original = t.host.call.bind(t.host);
      t.host.call = <T>(call: { method: string }): Promise<T> =>
        call.method === method
          ? gate.then(() => original<T>(call as never))
          : original<T>(call as never);
      return release;
    }

    it('a start in flight finishes, then the take is stopped and saved', async () => {
      const t = build();
      const release = holdCall(t, 'recordStart');
      const starting = t.service.start(sources);
      await vi.waitFor(() => {
        expect(t.service.gate.phase).toBe('Preparing');
      });
      expect(t.service.hasPendingSaves).toBe(true);
      const closing = t.service.shutdown();
      release();
      expect(await closing).toBe(true);
      expect(await starting).toMatchObject({ started: true });
      expect(t.service.gate.phase).toBe('Idle');
      expect(t.store.saves.length).toBeGreaterThan(0);
    });

    it('an import in flight finishes into a saved meeting', async () => {
      const picked = { title: 'Call', folderId: null, path: 'C:/in/call.mp3' };
      const t = build();
      const release = holdCall(t, 'importAudio');
      const importing = t.service.importAudio(picked);
      await vi.waitFor(() => {
        expect(t.service.gate.phase).toBe('Preparing');
      });
      const closing = t.service.shutdown();
      release();
      expect(await closing).toBe(true);
      expect(await importing).toMatchObject({ started: true });
      expect(t.store.saves.length).toBeGreaterThan(0);
    });

    it('a start that never settles gives up after the 30 s grace and reports not saved', async () => {
      vi.useFakeTimers();
      try {
        const t = build();
        holdCall(t, 'recordStart');
        void t.service.start(sources);
        await vi.waitFor(() => {
          expect(t.service.gate.phase).toBe('Preparing');
        });
        const closing = t.service.shutdown();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(await closing).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
