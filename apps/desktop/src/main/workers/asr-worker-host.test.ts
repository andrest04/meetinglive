import type { AsrResultDto } from '@vozella/contracts';
import type { Logger, RecognizerSettings } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import type { NativeHandle, NemoLibrary } from '../../workers/asr/nemo-library';
import { AsrWorkerHost } from './asr-worker-host';
import { inProcessAsrWorker, type InProcessAsrWorker } from './in-process-asr-worker';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

class ScriptedLibrary implements NemoLibrary {
  readonly version = 'scripted';
  readonly log: string[] = [];
  queue: AsrResultDto[] = [];
  gate: Promise<void> | null = null;
  createRecognizer(): NativeHandle {
    this.log.push('create');
    return { r: 1 };
  }
  destroyRecognizer(): void {
    this.log.push('destroy');
  }
  startStream(): NativeHandle {
    this.log.push('start');
    return { s: 1 };
  }
  pushF32(_s: NativeHandle, samples: Float32Array, rate: number): void {
    this.log.push(`push ${String(samples.length)}@${String(rate)}`);
  }
  next(): AsrResultDto | null {
    return this.queue.shift() ?? null;
  }
  closeStream(): void {
    this.log.push('close');
  }
}

const settings: RecognizerSettings = {
  modelPath: 'C:/m.gguf',
  binDirectory: 'C:/bin',
  gpu: -1,
  diarizationModelPath: null,
  geometry: {
    chunkFrames: 0,
    rightContextFrames: 0,
    leftContextFrames: -1,
    fifoFrames: 0,
    speakerCacheFrames: 0,
    updatePeriodFrames: 0,
  },
  latency: 'live',
};

function setup() {
  const library = new ScriptedLibrary();
  const workers: InProcessAsrWorker[] = [];
  const host = new AsrWorkerHost({
    logger,
    spawn: () => {
      const worker = inProcessAsrWorker(() => library);
      workers.push(worker);
      return worker;
    },
    requestTimeoutMs: 500,
  });
  return { host, library, workers };
}

describe('AsrWorkerHost', () => {
  it('pings the worker lazily and loads a library', async () => {
    const { host } = setup();
    expect(await host.ping()).toBe('in-process');
    expect(await host.loadLibrary('C:/bin')).toBe('scripted');
    await host.dispose();
  });

  it('creates a recognizer and a stream, pushes samples and pulls validated results', async () => {
    const { host, library } = setup();
    library.queue = [
      {
        isFinal: true,
        transcript: 'hola',
        audioProcessedSeconds: 1,
        words: [{ startMs: 0, endMs: 900, speakerTag: 0, text: 'hola' }],
      },
    ];
    const recognizer = await host.createRecognizer(settings);
    const stream = await recognizer.startStream({
      language: 'es-US',
      interimResults: true,
      diarization: false,
    });
    await stream.push(new Float32Array(1600), 16_000);
    const results = await stream.pullAvailable();
    expect(results).toHaveLength(1);
    expect(results[0]?.words[0]?.text).toBe('hola');
    await stream.dispose();
    await stream.dispose();
    await recognizer.dispose();
    await recognizer.dispose();
    expect(library.log).toEqual(['create', 'start', 'push 1600@16000', 'close', 'destroy']);
    await host.dispose();
  });

  it('fails the calls in flight when the process dies, and old handles are void afterwards', async () => {
    const { host, workers } = setup();
    const recognizer = await host.createRecognizer(settings);
    const stream = await recognizer.startStream({
      language: 'auto',
      interimResults: true,
      diarization: false,
    });
    const pending = stream.push(new Float32Array(10), 16_000);
    workers[0]?.crash();
    await expect(pending).rejects.toThrow('The speech engine stopped unexpectedly.');
    await expect(stream.push(new Float32Array(10), 16_000)).rejects.toThrow(/restarted/);
    // Disposing a handle of a dead process is not an error: there is nothing left to free.
    await expect(stream.dispose()).resolves.toBeUndefined();
    await expect(recognizer.dispose()).resolves.toBeUndefined();
    await host.dispose();
  });

  it('a recognizer made after a restart works', async () => {
    const { host, workers } = setup();
    await host.createRecognizer(settings);
    workers[0]?.crash();
    await new Promise((r) => setTimeout(r, 400));
    const again = await host.createRecognizer(settings);
    expect(again).toBeDefined();
    await host.dispose();
  });

  it('a native error becomes a rejected call with the engine message', async () => {
    const library = new ScriptedLibrary();
    library.createRecognizer = () => {
      throw new Error('nemo_speech_asr_create failed: model file is damaged');
    };
    const host = new AsrWorkerHost({ logger, spawn: () => inProcessAsrWorker(() => library) });
    await expect(host.createRecognizer(settings)).rejects.toThrow(
      'nemo_speech_asr_create failed: model file is damaged',
    );
    await host.dispose();
  });
});
