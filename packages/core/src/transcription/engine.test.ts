import { describe, expect, it, vi } from 'vitest';
import { CancelSource } from '../cancel';
import {
  MEETING_GEOMETRY,
  STREAMING_GEOMETRY,
  rightContextFrames,
  SUPPORTED_RIGHT_CONTEXT_FRAMES,
  type AsrResult,
} from './asr-types';
import { AsrBackendStatus, droppedPercent } from './backend-status';
import { NEMO_RUNTIMES, NEMOTRON_MODEL, SORTFORMER_MODEL } from './engine-catalog';
import { TranscriptionEngineInstaller } from './engine-installer';
import { LIVE_QUEUE_CAPACITY, LiveTranscriptionService } from './live-service';
import { TranscriptionService } from './offline-service';
import { RuntimeInUseError, TranscriptionCancelledError } from './ports';
import { NemoSpeechRecognizerFactory, hasNvidiaGpu, selectBackend } from './recognizer-factory';
import { FakeAsrEngine, FakeAudioReader, FakeModelStore, FakeRuntimeStore } from './test-kit';

const final = (text: string, end: number): AsrResult => ({
  isFinal: true,
  transcript: text,
  audioProcessedSeconds: end,
  words: [{ startMs: 0, endMs: end * 1000, speakerTag: 0, text: null }],
});
const interim = (text: string, end = 0): AsrResult => ({
  isFinal: false,
  transcript: text,
  audioProcessedSeconds: end,
  words: [],
});

function setup(gpuName: string | null = null) {
  const engine = new FakeAsrEngine();
  const models = new FakeModelStore();
  const runtimes = new FakeRuntimeStore();
  models.model = true;
  runtimes.ready.add('cpu');
  const status = new AsrBackendStatus();
  const factory = new NemoSpeechRecognizerFactory({
    engine,
    models,
    runtimes,
    hardware: () => Promise.resolve({ gpuName }),
    status,
  });
  return { engine, models, runtimes, status, factory };
}

describe('latency profiles and geometry', () => {
  it('RightContextFrames_MapsProfileToModelSupportedFrames', () => {
    expect(rightContextFrames('live')).toBe(3);
    expect(rightContextFrames('offline')).toBe(13);
  });
  it('RightContextFrames_EveryProfileIsAModelSupportedValue', () => {
    for (const profile of ['live', 'offline'] as const) {
      expect(SUPPORTED_RIGHT_CONTEXT_FRAMES).toContain(rightContextFrames(profile));
    }
  });
  it('MeetingGeometry_MatchesHuggingFaceVeryHighLatencyFrames', () => {
    expect(MEETING_GEOMETRY).toEqual({
      chunkFrames: 340,
      rightContextFrames: 40,
      leftContextFrames: -1,
      fifoFrames: 40,
      speakerCacheFrames: 188,
      updatePeriodFrames: 300,
    });
    expect(STREAMING_GEOMETRY.leftContextFrames).toBe(-1);
  });
});

describe('catalog pins', () => {
  it('pins v0.3.0 runtimes and checksummed GGUF files', () => {
    expect(NEMO_RUNTIMES.cpu.url).toContain('/v0.3.0/nemo-speech-0.3.0-windows-x86_64-cpu.zip');
    expect(NEMO_RUNTIMES.cuda.url).toContain('/v0.3.0/nemo-speech-0.3.0-windows-x86_64-cuda.zip');
    for (const file of [NEMOTRON_MODEL, SORTFORMER_MODEL]) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.url).toMatch(/resolve\/[0-9a-f]{40}\//);
    }
    for (const runtime of Object.values(NEMO_RUNTIMES))
      expect(runtime.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('recognizer factory', () => {
  it('SelectBackend uses the GPU name', () => {
    expect(selectBackend({ gpuName: 'NVIDIA GeForce RTX 3070' })).toBe('cuda');
    expect(selectBackend({ gpuName: 'quadro p1000' })).toBe('cuda');
    expect(selectBackend({ gpuName: 'Tesla T4' })).toBe('cuda');
    expect(selectBackend({ gpuName: 'Intel UHD' })).toBe('cpu');
    expect(hasNvidiaGpu({ gpuName: '  ' })).toBe(false);
    expect(hasNvidiaGpu({ gpuName: null })).toBe(false);
    expect(hasNvidiaGpu({ gpuName: 'NVIDIA RTX A2000' })).toBe(true);
    expect(hasNvidiaGpu({ gpuName: 'GeForce GTX 1650' })).toBe(true);
    expect(hasNvidiaGpu({ gpuName: 'AMD Radeon RX 7800' })).toBe(false);
    expect(hasNvidiaGpu({ gpuName: 'RTX 3070' })).toBe(false);
  });

  it('Create_WhenDiarizationDisabled_DoesNotRequireDiarModel', async () => {
    const { factory, engine } = setup();
    const created = await factory.create({ enableDiarization: false });
    expect(created.diarization).toBe(false);
    expect(engine.recognizers[0]?.settings.diarizationModelPath).toBeNull();
  });

  it('Create_WhenDiarizationEnabledAndFilePresent_PassesPath', async () => {
    const { factory, engine, models } = setup();
    models.diarization = true;
    const created = await factory.create({ enableDiarization: true });
    expect(created.diarization).toBe(true);
    expect(engine.recognizers[0]?.settings.diarizationModelPath).toBe('C:/models/diar.gguf');
  });

  it('Create_WhenDiarizationEnabledAndFileMissing_CreatesWithoutThrowing and says so (B7)', async () => {
    const { factory, engine, status } = setup();
    await factory.create({ enableDiarization: true });
    expect(engine.recognizers[0]?.settings.diarizationModelPath).toBeNull();
    expect(status.current?.diarization).toBe('model-missing');
  });

  it('Create_DefaultGeometry_IsStreaming and Create_DefaultLatency_IsLive', async () => {
    const { factory, engine } = setup();
    await factory.create();
    expect(engine.recognizers[0]?.settings.geometry).toEqual(STREAMING_GEOMETRY);
    expect(engine.recognizers[0]?.settings.latency).toBe('live');
  });

  it('Create_WhenOfflineLatencyAndMeetingGeometry_PassesBothToEngine', async () => {
    const { factory, engine } = setup();
    await factory.create({ latency: 'offline', geometry: MEETING_GEOMETRY });
    expect(engine.recognizers[0]?.settings.geometry).toEqual(MEETING_GEOMETRY);
    expect(engine.recognizers[0]?.settings.latency).toBe('offline');
  });

  it('Create_WhenCudaSucceeds_ReportsCudaWithoutFallbackReason', async () => {
    const { factory, runtimes, engine, status } = setup('NVIDIA GeForce RTX');
    runtimes.ready.add('cuda');
    const created = await factory.create();
    expect(created.backend).toBe('cuda');
    expect(engine.recognizers[0]?.settings.gpu).toBe(0);
    expect(status.current).toEqual({ backend: 'cuda', fallbackReason: null, diarization: 'off' });
  });

  it('Create_WhenCudaCreateThrows_FallsBackToCpuAndReportsReason, keeping latency and geometry', async () => {
    const { factory, runtimes, engine, status } = setup('NVIDIA GeForce RTX');
    runtimes.ready.add('cuda');
    engine.failGpu.set(0, 'cuda driver too old');
    await factory.create({ latency: 'offline', geometry: MEETING_GEOMETRY });
    const settings = engine.recognizers[0]?.settings;
    expect(settings?.gpu).toBe(-1);
    expect(settings?.latency).toBe('offline');
    expect(settings?.geometry).toEqual(MEETING_GEOMETRY);
    expect(status.current).toEqual({
      backend: 'cpu',
      fallbackReason: 'cuda driver too old',
      diarization: 'off',
    });
  });

  it('Create_WhenNoNvidiaGpu_ReportsCpuWithoutFallbackReason', async () => {
    const { factory, status } = setup('Intel UHD');
    await factory.create();
    expect(status.current?.fallbackReason).toBeNull();
  });

  it('Create_WhenCudaRuntimeMissing_ReportsCpuWithoutFallbackReason', async () => {
    const { factory, status } = setup('NVIDIA GeForce RTX');
    await factory.create();
    expect(status.current).toMatchObject({ backend: 'cpu', fallbackReason: null });
  });

  it('works without a status sink and raises Changed with the new usage', async () => {
    const { engine, models, runtimes } = setup();
    const bare = new NemoSpeechRecognizerFactory({
      engine,
      models,
      runtimes,
      hardware: () => Promise.resolve({ gpuName: null }),
    });
    await expect(bare.create()).resolves.toBeDefined();
    const { factory, status } = setup();
    const seen = vi.fn();
    status.onChanged(seen);
    await factory.create();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('throws the two exact messages for a missing model and a missing CPU runtime', async () => {
    const a = setup();
    a.models.model = false;
    await expect(a.factory.create()).rejects.toThrow('The Nemotron ASR model is not installed.');
    const b = setup();
    b.runtimes.ready.clear();
    await expect(b.factory.create()).rejects.toThrow(
      'The Nemotron ASR CPU runtime is not installed.',
    );
  });
});

describe('AsrBackendStatus', () => {
  it('is null until the first report and computes the dropped percent', () => {
    const status = new AsrBackendStatus();
    expect(status.current).toBeNull();
    expect(status.lastLiveDrops).toBeNull();
    const seen = vi.fn();
    status.onLiveDropsChanged(seen);
    status.reportLiveDrops({ droppedMs: 500, totalMs: 10_000 });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(droppedPercent({ droppedMs: 500, totalMs: 10_000 })).toBe(5);
    expect(droppedPercent({ droppedMs: 5, totalMs: 0 })).toBe(0);
  });
});

describe('TranscriptionEngineInstaller', () => {
  const make = (gpuName: string | null) => {
    const models = new FakeModelStore();
    const runtimes = new FakeRuntimeStore();
    const installer = new TranscriptionEngineInstaller({
      models,
      runtimes,
      hardware: () => Promise.resolve({ gpuName }),
    });
    return { models, runtimes, installer };
  };

  it('IsReady_WhenAsrAndRuntimeReadyButDiarMissing_ReturnsTrue', () => {
    const { models, runtimes, installer } = make(null);
    models.model = true;
    runtimes.ready.add('cuda');
    expect(installer.isReady()).toBe(true);
    runtimes.ready.clear();
    expect(installer.isReady()).toBe(false);
  });

  it('EnsureAsync_WhenDiarMissing_DoesNotDownloadSortformer', async () => {
    const { models, installer } = make(null);
    await installer.ensure(() => undefined);
    expect(models.downloads).toEqual([NEMOTRON_MODEL.fileName]);
  });

  it('downloads the CUDA runtime, then the CPU fallback, then the model, with staged progress', async () => {
    const { runtimes, installer } = make('NVIDIA GeForce');
    const seen: string[] = [];
    await installer.ensure((p) =>
      seen.push(`${p.stage}:${String(p.stepIndex)}/${String(p.stepCount)}:${String(p.percent)}`),
    );
    expect(runtimes.downloads).toEqual(['cuda', 'cpu']);
    expect(seen.filter((s) => s.endsWith(':0'))).toEqual([
      'runtime-cuda:0/3:0',
      'runtime-cpu-fallback:1/3:0',
      'model:2/3:0',
    ]);
  });

  it('skips what is already installed', async () => {
    const { models, runtimes, installer } = make(null);
    models.model = true;
    runtimes.ready.add('cpu');
    await installer.ensure(() => undefined);
    expect(models.downloads).toEqual([]);
    expect(runtimes.downloads).toEqual([]);
  });

  it('ExpectedBackend rules', async () => {
    const nvidia = make('NVIDIA GeForce');
    expect(await nvidia.installer.expectedBackend()).toBe('cuda');
    nvidia.runtimes.ready.add('cpu');
    expect(await nvidia.installer.expectedBackend()).toBe('cpu');
    nvidia.runtimes.ready.add('cuda');
    expect(await nvidia.installer.expectedBackend()).toBe('cuda');
    const intel = make('Intel');
    intel.runtimes.ready.add('cuda');
    expect(await intel.installer.expectedBackend()).toBe('cpu');
  });

  it('downloads the speaker model only on request', async () => {
    const { models, installer } = make(null);
    await installer.ensureDiarizationModel(() => undefined);
    expect(models.downloads).toEqual([SORTFORMER_MODEL.fileName]);
    await installer.ensureDiarizationModel(() => undefined);
    expect(models.downloads).toHaveLength(1);
  });

  describe('deleteEngine', () => {
    it('removes the runtime and both models (B6)', async () => {
      const { models, runtimes, installer } = make(null);
      models.model = true;
      models.diarization = true;
      runtimes.ready.add('cpu');
      expect(await installer.deleteEngine()).toBe('Deleted');
      expect(models.model).toBe(false);
      expect(models.diarization).toBe(false);
    });
    it('keeps the models when the runtime is in use', async () => {
      const { models, runtimes, installer } = make(null);
      models.model = true;
      runtimes.deleteError = new RuntimeInUseError('x.dll');
      expect(await installer.deleteEngine()).toBe('RuntimeInUse');
      expect(models.model).toBe(true);
    });
    it('keeps the models when the runtime fails partway', async () => {
      const { models, runtimes, installer } = make(null);
      models.model = true;
      runtimes.deleteError = new Error('EBUSY');
      expect(await installer.deleteEngine()).toBe('Incomplete');
      expect(models.model).toBe(true);
    });
    it('reports Incomplete when the model is locked', async () => {
      const { models, installer } = make(null);
      models.model = true;
      models.deleteModelError = new Error('EBUSY');
      models.diarization = true;
      expect(await installer.deleteEngine()).toBe('Incomplete');
      expect(models.diarization).toBe(false);
    });
  });
});

describe('TranscriptionService (offline pass)', () => {
  const stamp = { ...final('hola mundo', 1) };

  it('pushes the WAV through a stream, never finishes, and disposes once (locale es-US, Meeting geometry, Offline latency)', async () => {
    const { engine, factory } = setup();
    engine.script = { afterPush: [[stamp]] };
    const audio = new FakeAudioReader(new Float32Array(3200), 16_000, 1);
    const progress: number[] = [];
    const text = await new TranscriptionService({ factory, audio }).transcribe({
      audioPath: 'a.wav',
      language: 'es',
      recordedAtMs: null,
      speakerDiarization: false,
      onProgress: (p) => progress.push(p),
    });
    const recognizer = engine.recognizers[0];
    const stream = recognizer?.streams[0];
    expect(text).toBe('[00:00.00-00:01.00] hola mundo');
    expect(recognizer?.settings.geometry).toEqual(MEETING_GEOMETRY);
    expect(recognizer?.settings.latency).toBe('offline');
    expect(stream?.options.language).toBe('es-US');
    expect(stream?.finishCalled).toBe(false);
    expect(stream?.disposed).toBe(1);
    expect(recognizer?.disposed).toBe(1);
    expect(audio.closed).toBe(1);
    expect(progress).toEqual([50, 100]);
  });

  it('TranscribeAsync_WhenStreamYieldsNothing_ReturnsEmpty', async () => {
    const { factory } = setup();
    const audio = new FakeAudioReader(new Float32Array(1600));
    expect(
      await new TranscriptionService({ factory, audio }).transcribe({
        audioPath: 'a.wav',
        language: 'en',
        recordedAtMs: null,
        speakerDiarization: false,
      }),
    ).toBe('');
  });

  it('averages channels to mono and sends the actual rate; skips an empty frame', async () => {
    const { engine, factory } = setup();
    const stereo = new Float32Array([1, 0, 0.5, 0.5, 0, 1]);
    const audio = new FakeAudioReader(stereo, 22_050, 2);
    await new TranscriptionService({ factory, audio }).transcribe({
      audioPath: 'a.wav',
      language: 'en',
      recordedAtMs: null,
      speakerDiarization: false,
    });
    const push = engine.recognizers[0]?.streams[0]?.pushes[0];
    expect(push?.sampleRate).toBe(22_050);
    expect([...(push?.samples ?? [])]).toEqual([0.5, 0.5, 0.5]);
  });

  it('skips a frame that has no whole sample per channel', async () => {
    const { engine, factory } = setup();
    const audio = new FakeAudioReader(new Float32Array([1]), 16_000, 2);
    await new TranscriptionService({ factory, audio }).transcribe({
      audioPath: 'a.wav',
      language: 'en',
      recordedAtMs: null,
      speakerDiarization: false,
    });
    expect(engine.recognizers[0]?.streams[0]?.pushes ?? []).toHaveLength(0);
  });

  it('commits the leftover interim at the end', async () => {
    const { engine, factory } = setup();
    engine.script = { afterPush: [[interim('tail words', 1)]] };
    const text = await new TranscriptionService({
      factory,
      audio: new FakeAudioReader(new Float32Array(1600)),
    }).transcribe({
      audioPath: 'a',
      language: 'en',
      recordedAtMs: null,
      speakerDiarization: false,
    });
    expect(text).toBe('[00:00.00-00:01.00] tail words');
  });

  it('rejects at once when already cancelled, without building a recognizer', async () => {
    const { engine, factory } = setup();
    const cancel = new CancelSource();
    cancel.cancel();
    await expect(
      new TranscriptionService({
        factory,
        audio: new FakeAudioReader(new Float32Array(10)),
      }).transcribe({
        audioPath: 'a',
        language: 'en',
        recordedAtMs: null,
        speakerDiarization: false,
        cancel,
      }),
    ).rejects.toBeInstanceOf(TranscriptionCancelledError);
    expect(engine.recognizers).toHaveLength(0);
  });

  it('cancels between frames and still disposes everything', async () => {
    const { engine, factory } = setup();
    const cancel = new CancelSource();
    engine.script = {
      pushGate: () => {
        cancel.cancel();
        return Promise.resolve();
      },
    };
    await expect(
      new TranscriptionService({
        factory,
        audio: new FakeAudioReader(new Float32Array(16_000)),
      }).transcribe({
        audioPath: 'a',
        language: 'en',
        recordedAtMs: null,
        speakerDiarization: false,
        cancel,
      }),
    ).rejects.toBeInstanceOf(TranscriptionCancelledError);
    expect(engine.recognizers[0]?.disposed).toBe(1);
    expect(engine.recognizers[0]?.streams[0]?.disposed).toBe(1);
  });

  it('disposes the recognizer when the file cannot be opened', async () => {
    const { engine, factory } = setup();
    const audio = new FakeAudioReader(new Float32Array(1), 16_000, 1, new Error('not a WAV'));
    await expect(
      new TranscriptionService({ factory, audio }).transcribe({
        audioPath: 'a',
        language: 'en',
        recordedAtMs: null,
        speakerDiarization: false,
      }),
    ).rejects.toThrow('not a WAV');
    expect(engine.recognizers[0]?.disposed).toBe(1);
  });
});

describe('LiveTranscriptionService', () => {
  const frame = (): Float32Array => new Float32Array(1600);
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  it('Stop_ClosesStreamWithoutFinishAndDrain and returns the committed text', async () => {
    const { engine, factory } = setup();
    engine.script = { afterPush: [[final('hola', 1)]] };
    const live = new LiveTranscriptionService({ factory });
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    live.pushFrame(frame(), 16_000);
    await flush();
    const text = await live.stop();
    const recognizer = engine.recognizers[0];
    expect(text).toBe('[00:00.00-00:01.00] hola');
    expect(recognizer?.streams[0]?.finishCalled).toBe(false);
    expect(recognizer?.streams[0]?.disposed).toBe(1);
    expect(recognizer?.disposed).toBe(1);
    expect(recognizer?.streams[0]?.options).toMatchObject({
      language: 'es-US',
      interimResults: true,
    });
  });

  it('TranscriptUpdated_RaisesCommittedTextSeparatelyFromDisplay', async () => {
    const { engine, factory } = setup();
    engine.script = { afterPush: [[final('uno', 1)], [interim('dos')]] };
    const live = new LiveTranscriptionService({ factory });
    const updates: { displayText: string; committedText: string }[] = [];
    live.onTranscriptUpdated((u) => updates.push(u));
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    live.pushFrame(frame(), 16_000);
    await flush();
    live.pushFrame(frame(), 16_000);
    await flush();
    await live.stop();
    expect(updates[1]).toEqual({
      displayText: '[00:00.00-00:01.00] uno\ndos',
      committedText: '[00:00.00-00:01.00] uno',
    });
  });

  it('OnPcmFrame_WhenNativePushBlocks_DoesNotBlockTheCaller; drops the oldest frames', async () => {
    const { engine, factory, status } = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    engine.script = { pushGate: () => gate };
    const live = new LiveTranscriptionService({ factory, status });
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    const total = LIVE_QUEUE_CAPACITY + 1 + 4;
    live.pushFrame(frame(), 16_000);
    await flush();
    for (let i = 1; i < total; i += 1) live.pushFrame(frame(), 16_000);
    release();
    await live.stop();
    const drops = status.lastLiveDrops;
    expect(drops?.totalMs).toBe(total * 100);
    // One frame is inside the blocked push; the queue holds 8; the rest were dropped.
    expect(drops?.droppedMs).toBe(4 * 100);
  });

  it('Stop_WhenNothingWasDropped_PublishesZeroPercent and raises the event once', async () => {
    const { factory, status } = setup();
    const seen = vi.fn();
    status.onLiveDropsChanged(seen);
    const live = new LiveTranscriptionService({ factory, status });
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    live.pushFrame(frame(), 16_000);
    await live.stop();
    await live.stop();
    expect(droppedPercent(status.lastLiveDrops ?? { droppedMs: 1, totalMs: 1 })).toBe(0);
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('Start_ResetsTheCountersOfThePreviousSession', async () => {
    const { factory, status } = setup();
    const live = new LiveTranscriptionService({ factory, status });
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    live.pushFrame(frame(), 16_000);
    await live.stop();
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    await live.stop();
    expect(status.lastLiveDrops).toEqual({ droppedMs: 0, totalMs: 0 });
  });

  it('Stop returns an empty string when nothing is running', async () => {
    const { factory } = setup();
    expect(await new LiveTranscriptionService({ factory }).stop()).toBe('');
  });

  it('Start stops a running session first', async () => {
    const { engine, factory } = setup();
    const live = new LiveTranscriptionService({ factory });
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    await live.start({ language: 'en', recordedAtMs: null, speakerDiarization: false });
    expect(engine.recognizers[0]?.disposed).toBe(1);
    expect(live.isRunning).toBe(true);
    await live.stop();
  });

  it('Start disposes the recognizer and rethrows when the stream cannot open', async () => {
    const { engine, factory } = setup();
    engine.startError = new Error('stream failed');
    const live = new LiveTranscriptionService({ factory });
    await expect(
      live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false }),
    ).rejects.toThrow('stream failed');
    expect(engine.recognizers[0]?.disposed).toBe(1);
    expect(live.isRunning).toBe(false);
  });

  it('swallows a native push error per frame and keeps going', async () => {
    const { engine, factory } = setup();
    engine.script = { pushError: new Error('boom') };
    const errors: unknown[] = [];
    const live = new LiveTranscriptionService({ factory, onError: (e) => errors.push(e) });
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    live.pushFrame(frame(), 16_000);
    live.pushFrame(frame(), 16_000);
    await expect(live.stop()).resolves.toBe('');
    expect(errors).toHaveLength(2);
  });

  it('B4: a throwing subscriber does not leave the engine open', async () => {
    const { engine, factory } = setup();
    engine.script = { afterPush: [[final('uno', 1)]] };
    const errors: unknown[] = [];
    const live = new LiveTranscriptionService({ factory, onError: (e) => errors.push(e) });
    live.onTranscriptUpdated(() => {
      throw new Error('subscriber failed');
    });
    await live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    live.pushFrame(frame(), 16_000);
    await flush();
    await expect(live.stop()).resolves.toBe('[00:00.00-00:01.00] uno');
    expect(engine.recognizers[0]?.disposed).toBe(1);
    expect(engine.recognizers[0]?.streams[0]?.disposed).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('B12: a Start and a Stop issued together never see a half started session', async () => {
    const { engine, factory } = setup();
    const live = new LiveTranscriptionService({ factory });
    const started = live.start({ language: 'es', recordedAtMs: null, speakerDiarization: false });
    const stopped = live.stop();
    await started;
    await stopped;
    expect(live.isRunning).toBe(false);
    expect(engine.recognizers[0]?.disposed).toBe(1);
  });
});
