import {
  CancelSource,
  FakeAsrEngine,
  FakeAudioReader,
  FakeModelStore,
  FakeRuntimeStore,
  InMemoryMeetingRepository,
  InMemorySettingsStore,
  MeetingBusyRegistry,
  RuntimeInUseError,
  createLookup,
  type AsrResult,
  type Logger,
  type MeetingRecord,
} from '@vozella/core';
import { TranscriptionRuntime } from '@vozella/platform';
import { describe, expect, it, vi } from 'vitest';
import { mainCatalogs } from '../i18n/main-catalogs';
import { TranscriptionController } from './transcription-controller';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const t = createLookup(mainCatalogs, 'en');

const final = (text: string, endSeconds: number): AsrResult => ({
  isFinal: true,
  transcript: text,
  audioProcessedSeconds: endSeconds,
  words: [{ startMs: 0, endMs: endSeconds * 1000, speakerTag: 0, text: null }],
});

const record = (patch: Partial<MeetingRecord> = {}): MeetingRecord => ({
  id: 'm1',
  title: 'Weekly',
  recordedAt: '2026-11-02T14:00:00.0000000+00:00',
  endedAt: '2026-11-02T14:52:00.0000000+00:00',
  audioFilePath: 'C:/audio/m1.wav',
  sourcePath: null,
  folderId: null,
  summaryProvider: null,
  calendarEventId: null,
  calendarId: null,
  seriesId: null,
  joinUrl: null,
  noteTemplateId: null,
  attendees: [],
  brief: null,
  transcript: '[00:00.00-00:01.00] old words\n* [00:05.00-00:06.00] starred old line',
  summary: 'kept summary',
  actionItems: [],
  jevAnalysis: null,
  notes: null,
  followUp: null,
  projectPlan: null,
  ...patch,
});

function setup(options: { ready?: boolean; gpuName?: string | null } = {}) {
  const engine = new FakeAsrEngine();
  const models = new FakeModelStore();
  const runtimes = new FakeRuntimeStore();
  if (options.ready !== false) {
    models.model = true;
    runtimes.ready.add('cpu');
  }
  const audio = new FakeAudioReader(new Float32Array(3200));
  const runtime = new TranscriptionRuntime({
    transcriptionModelsDirectory: 'unused',
    nemoSpeechDirectory: 'unused',
    engine,
    hardware: () => Promise.resolve({ gpuName: options.gpuName ?? null }),
    logger,
    audio,
    stores: { models, runtimes },
  });
  const settings = new InMemorySettingsStore();
  const meetings = new InMemoryMeetingRepository();
  const busy = new MeetingBusyRegistry();
  const events: { channel: string; payload: unknown }[] = [];
  const frameListeners = new Set<(pcm: Uint8Array) => void>();
  const changed: string[] = [];
  const controller = new TranscriptionController({
    runtime,
    settings,
    meetings,
    busy,
    broadcast: (channel, payload) => {
      events.push({ channel: channel.name, payload });
    },
    logger,
    t,
    onRecordingFrames: (listener) => {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    fileExists: () => true,
    onMeetingChanged: (id) => changed.push(id),
    defer: (task) => {
      task();
    },
  });
  return {
    controller,
    engine,
    models,
    runtimes,
    settings,
    meetings,
    busy,
    events,
    frameListeners,
    changed,
    runtime,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

describe('status', () => {
  it('reports readiness, backends, settings and the language', async () => {
    const { controller, models, runtimes } = setup({ ready: false, gpuName: 'NVIDIA GeForce' });
    expect(await controller.status()).toMatchObject({
      ready: false,
      modelInstalled: false,
      runtimes: { cpu: false, cuda: false },
      expectedBackend: 'cuda',
      usage: null,
      liveDroppedPercent: null,
      liveEnabled: true,
      speakerLabelsEnabled: false,
      language: 'es',
      installing: null,
    });
    models.model = true;
    runtimes.ready.add('cpu');
    expect(await controller.status()).toMatchObject({ ready: true, expectedBackend: 'cpu' });
  });
});

describe('ensureEngine', () => {
  it('downloads what is missing, reports staged progress, and ends ready', async () => {
    const { controller, events, models } = setup({ ready: false });
    const outcome = await controller.ensureEngine();
    expect(outcome).toEqual({ status: 'ready' });
    expect(models.model).toBe(true);
    const progress = events.filter((e) => e.channel === 'transcription.installProgress');
    expect(progress.map((e) => (e.payload as { stage: string }).stage)).toEqual([
      'runtime-cpu',
      'runtime-cpu',
      'model',
      'model',
    ]);
    await flush();
    expect(events.some((e) => e.channel === 'transcription.statusChanged')).toBe(true);
  });

  it('a second call shares the first', async () => {
    const { controller, runtimes } = setup({ ready: false });
    const [a, b] = await Promise.all([controller.ensureEngine(), controller.ensureEngine()]);
    expect(a).toEqual(b);
    expect(runtimes.downloads).toEqual(['cpu']);
  });

  it('a failure becomes a value with the raw message, and the dialog may try again', async () => {
    const { controller, runtimes } = setup({ ready: false });
    runtimes.download = () => Promise.reject(new Error('getaddrinfo ENOTFOUND github.com'));
    expect(await controller.ensureEngine()).toEqual({
      status: 'failed',
      message: 'getaddrinfo ENOTFOUND github.com',
    });
    runtimes.download = FakeRuntimeStore.prototype.download.bind(runtimes);
    expect(await controller.ensureEngine()).toEqual({ status: 'ready' });
  });

  it('a download that ends but leaves the engine unready says so in the app language', async () => {
    const { controller, models } = setup({ ready: false });
    models.download = () => Promise.resolve();
    expect(await controller.ensureEngine()).toEqual({
      status: 'failed',
      message: 'Download finished but the transcription engine is still not ready.',
    });
  });

  it('cancelling is silent: the outcome is cancelled, not a failure', async () => {
    const { controller, models } = setup({ ready: false });
    models.download = (_file, _progress, cancel) =>
      new Promise((_resolve, reject) => {
        cancel?.onCancel(() => {
          reject(new Error('The download was cancelled.'));
        });
      });
    const pending = controller.ensureEngine();
    await flush();
    expect(controller.cancelInstall()).toBe(true);
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(controller.cancelInstall()).toBe(false);
  });

  it('a download asked for right after a cancel starts again instead of joining the cancelled one', async () => {
    const { controller, models } = setup({ ready: false });
    let attempts = 0;
    let finishFirst: () => void = () => undefined;
    models.download = (file, progress, cancel) => {
      attempts += 1;
      if (attempts > 1)
        return FakeModelStore.prototype.download.call(models, file, progress, cancel);
      // The first transfer notices the cancel only later, as a stepped download does.
      return new Promise((_resolve, reject) => {
        finishFirst = () => {
          reject(new Error('The download was cancelled.'));
        };
      });
    };
    const first = controller.ensureEngine();
    await flush();
    expect(controller.cancelInstall()).toBe(true);
    const second = controller.ensureEngine();
    finishFirst();
    expect(await first).toEqual({ status: 'cancelled' });
    expect(await second).toEqual({ status: 'ready' });
    expect(attempts).toBe(2);
  });

  it('delete reports the outcomes and publishes the new status', async () => {
    const { controller, runtimes, events } = setup();
    runtimes.deleteError = new RuntimeInUseError('nemo_speech_asr_c.dll');
    expect(await controller.deleteEngine()).toBe('RuntimeInUse');
    runtimes.deleteError = null;
    expect(await controller.deleteEngine()).toBe('Deleted');
    await flush();
    expect(
      events.filter((e) => e.channel === 'transcription.statusChanged').length,
    ).toBeGreaterThan(0);
  });
});

describe('settings', () => {
  it('live transcription: a no-op when unchanged, saved when changed', async () => {
    const { controller, settings } = setup();
    expect(await controller.setLiveEnabled(true)).toBe(false);
    expect(await controller.setLiveEnabled(false)).toBe(true);
    expect((await settings.load()).liveTranscriptionEnabled).toBe(false);
  });

  it('speaker labels on without the model downloads it first, then saves', async () => {
    const { controller, settings, models } = setup();
    expect(await controller.setSpeakerLabels(true)).toEqual({ status: 'saved', enabled: true });
    expect(models.diarization).toBe(true);
    expect((await settings.load()).speakerDiarizationEnabled).toBe(true);
  });

  it('B7: a failed model download leaves the labels off and says why', async () => {
    const { controller, settings, models } = setup();
    models.download = () => Promise.reject(new Error('HTTP 503'));
    expect(await controller.setSpeakerLabels(true)).toEqual({
      status: 'failed',
      message: 'HTTP 503',
    });
    expect((await settings.load()).speakerDiarizationEnabled).toBe(false);
  });

  it('B7: deleting the speaker model turns the labels off', async () => {
    const { controller, settings, models } = setup();
    await controller.setSpeakerLabels(true);
    expect(await controller.deleteSpeakerModel()).toEqual({ status: 'deleted' });
    expect(models.diarization).toBe(false);
    expect((await settings.load()).speakerDiarizationEnabled).toBe(false);
  });

  it('B7: deleting the engine also turns the speaker labels off', async () => {
    const { controller, settings, models } = setup();
    await controller.setSpeakerLabels(true);
    expect(await controller.deleteEngine()).toBe('Deleted');
    expect(models.diarization).toBe(false);
    expect((await settings.load()).speakerDiarizationEnabled).toBe(false);
  });

  it('B17: a speaker model download is not mistaken for an engine install', async () => {
    const { controller, models, runtimes } = setup({ ready: false });
    let finish: () => void = () => undefined;
    models.download = (file) => {
      if (!file.fileName.startsWith('diar')) return Promise.resolve();
      return new Promise<void>((resolve) => {
        finish = () => {
          models.diarization = true;
          resolve();
        };
      });
    };
    const speaker = controller.downloadSpeakerModel();
    await flush();
    const engine = controller.ensureEngine();
    await flush();
    finish();
    expect(await speaker).toEqual({ status: 'ready' });
    await engine;
    expect(runtimes.ready.size).toBeGreaterThan(0);
  });

  it('B22: a locked speaker model is a message, not a crash', async () => {
    const { controller, models } = setup();
    models.deleteDiarError = new Error('EBUSY: resource busy or locked');
    expect(await controller.deleteSpeakerModel()).toEqual({
      status: 'failed',
      message: 'EBUSY: resource busy or locked',
    });
  });
});

describe('live pass', () => {
  const pcm = (samples: number): Uint8Array => new Uint8Array(samples * 2);

  it('does nothing when live transcription is off', async () => {
    const { controller, settings, engine, frameListeners } = setup();
    await settings.update({ liveTranscriptionEnabled: false });
    expect(await controller.startLive(null)).toEqual({ active: false });
    expect(engine.recognizers).toHaveLength(0);
    expect(frameListeners.size).toBe(0);
    expect(await controller.stopLive()).toBe('');
  });

  it('feeds recording frames to the engine, broadcasts updates, and returns the draft on stop', async () => {
    const { controller, engine, frameListeners, events } = setup();
    engine.script = { afterPush: [[final('hola equipo', 1)]] };
    expect(await controller.startLive(null)).toEqual({ active: true });
    expect(engine.recognizers[0]?.streams[0]?.options.language).toBe('es-US');
    for (const listener of frameListeners) listener(pcm(3200));
    await flush();
    const draft = await controller.stopLive();
    expect(draft).toBe('[00:00.00-00:01.00] hola equipo');
    expect(frameListeners.size).toBe(0);
    const updates = events.filter((e) => e.channel === 'transcription.liveUpdate');
    expect(updates).toHaveLength(1);
    const push = engine.recognizers[0]?.streams[0]?.pushes[0];
    expect(push?.samples).toHaveLength(3200);
    expect(push?.sampleRate).toBe(16_000);
  });

  it('item 19: if stopping fails, the text on screen is the draft', async () => {
    const { controller, engine, frameListeners, runtime } = setup();
    engine.script = { afterPush: [[final('en pantalla', 1)]] };
    await controller.startLive(null);
    for (const listener of frameListeners) listener(pcm(1600));
    await flush();
    runtime.live.stop = () => Promise.reject(new Error('native stop failed'));
    expect(await controller.stopLive()).toBe('[00:00.00-00:01.00] en pantalla');
  });

  it('item 19: a blank on-screen text becomes null when stopping fails', async () => {
    const { controller, engine, frameListeners, runtime } = setup();
    engine.script = { afterPush: [[final('   ', 1)]] };
    await controller.startLive(null);
    for (const listener of frameListeners) listener(pcm(1600));
    await flush();
    runtime.live.stop = () => Promise.reject(new Error('native stop failed'));
    expect(await controller.stopLive()).toBeNull();
  });

  it('uses the saved language and the speaker label setting', async () => {
    const { controller, engine, settings } = setup();
    await settings.update({ transcriptionLanguage: 'en', speakerDiarizationEnabled: true });
    await controller.startLive(null);
    expect(engine.recognizers[0]?.streams[0]?.options.language).toBe('en-US');
    await controller.stopLive();
  });
});

describe('offline pass', () => {
  it('transcribes with the settings language and reports progress', async () => {
    const { controller, engine, settings } = setup();
    await settings.update({ transcriptionLanguage: 'pt' });
    engine.script = { afterPush: [[final('olá', 0.2)]] };
    const progress: number[] = [];
    const text = await controller.transcribeFile({
      audioPath: 'a.wav',
      recordedAtMs: null,
      onProgress: (p) => progress.push(p),
    });
    expect(text).toBe('[00:00.00-00:00.20] olá');
    expect(engine.recognizers[0]?.streams[0]?.options.language).toBe('pt-BR');
    expect(progress.at(-1)).toBe(100);
  });
});

describe('re-transcription', () => {
  it('replaces the transcript, keeps the summary and the stars, and ends as TranscriptOnly', async () => {
    const { controller, engine, meetings, events, changed } = setup();
    await meetings.save(record());
    engine.script = { afterPush: [[final('nuevo texto', 1)]] };
    const started = await controller.startRetranscription('m1');
    expect(started).toEqual({ started: true, reason: null });
    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'retranscription.finished')).toBe(true);
    });
    const saved = await meetings.get('m1');
    expect(saved?.summary).toBe('kept summary');
    const lines = (saved?.transcript ?? '').split('\n');
    expect(lines[0]).toMatch(/^Recorded 2026-11-02/);
    expect(lines[1]).toMatch(/^Ended 2026-11-02/);
    expect(lines[2]).toBe('* [00:00.00-00:01.00] nuevo texto');
    expect(changed).toEqual(['m1']);
    const finished = events.find((e) => e.channel === 'retranscription.finished');
    expect(finished?.payload).toEqual({
      meetingId: 'm1',
      outcome: 'TranscriptOnly',
      message: null,
    });
    expect(controller.retranscription.isRunning).toBe(false);
  });

  it('B8: the old stars survive the new transcript', async () => {
    const { controller, engine, meetings, events } = setup();
    await meetings.save(record({ transcript: '[00:00.00-00:01.00] a\n* [00:00.00-00:01.00] b' }));
    engine.script = { afterPush: [[final('x', 1)]] };
    await controller.startRetranscription('m1');
    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'retranscription.finished')).toBe(true);
    });
    expect((await meetings.get('m1'))?.transcript).toContain('* [00:00.00-00:01.00] x');
  });

  it('an engine that is not installed fails with the app language message and leaves the transcript', async () => {
    const { controller, meetings, events } = setup({ ready: false });
    await meetings.save(record());
    await controller.startRetranscription('m1');
    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'retranscription.finished')).toBe(true);
    });
    expect(events.find((e) => e.channel === 'retranscription.finished')?.payload).toEqual({
      meetingId: 'm1',
      outcome: 'Failed',
      message: 'Download finished but the transcription engine is still not ready.',
    });
    expect((await meetings.get('m1'))?.transcript).toContain('old words');
  });

  it('an empty result keeps the old transcript and says no transcript was produced', async () => {
    const { controller, meetings, events } = setup();
    await meetings.save(record());
    await controller.startRetranscription('m1');
    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'retranscription.finished')).toBe(true);
    });
    expect(
      (events.find((e) => e.channel === 'retranscription.finished')?.payload as { outcome: string })
        .outcome,
    ).toBe('Failed');
    expect((await meetings.get('m1'))?.transcript).toContain('old words');
  });

  it('a pass that throws keeps the audio message with the reason', async () => {
    const { controller, engine, meetings, events } = setup();
    await meetings.save(record());
    engine.script = { pushError: new Error('boom') };
    await controller.startRetranscription('m1');
    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'retranscription.finished')).toBe(true);
    });
    const payload = events.find((e) => e.channel === 'retranscription.finished')?.payload as {
      outcome: string;
      message: string;
    };
    expect(payload.outcome).toBe('Failed');
    expect(payload.message).toContain('Transcription failed: boom');
  });

  it('cancel ends as Cancelled and touches nothing', async () => {
    const { controller, engine, meetings, events } = setup();
    await meetings.save(record());
    engine.script = {
      pushGate: () => {
        controller.cancelRetranscription();
        return Promise.resolve();
      },
    };
    await controller.startRetranscription('m1');
    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'retranscription.finished')).toBe(true);
    });
    expect(
      (events.find((e) => e.channel === 'retranscription.finished')?.payload as { outcome: string })
        .outcome,
    ).toBe('Cancelled');
    expect((await meetings.get('m1'))?.transcript).toContain('old words');
  });

  it('refuses a missing meeting, a second run, and a meeting that is busy; marks the meeting busy while it runs', async () => {
    const { controller, meetings, busy, engine, events } = setup();
    expect(await controller.startRetranscription('nope')).toEqual({
      started: false,
      reason: 'NotFound',
    });
    await meetings.save(record());
    const release = new CancelSource();
    engine.script = {
      pushGate: () =>
        new Promise<void>((resolve) => {
          release.onCancel(resolve);
        }),
    };
    await controller.startRetranscription('m1');
    await flush();
    expect(busy.isBusy('m1')).toBe(true);
    expect(await controller.startRetranscription('m1')).toEqual({
      started: false,
      reason: 'AlreadyRunning',
    });
    expect(await controller.retranscriptionAvailability('m1')).toBe('Busy');
    release.cancel();
    await vi.waitFor(() => {
      expect(events.some((e) => e.channel === 'retranscription.finished')).toBe(true);
    });
    expect(busy.isBusy('m1')).toBe(false);
  });

  it('availability follows the rules: no audio file is NoAudio', async () => {
    const { controller, meetings } = setup();
    await meetings.save(record({ audioFilePath: '' }));
    expect(await controller.retranscriptionAvailability('m1')).toBe('NoAudio');
    expect(await controller.startRetranscription('m1')).toEqual({
      started: false,
      reason: 'NoAudio',
    });
  });
});
