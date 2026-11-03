import type { AsrResultDto, AsrRpcCall, AsrWorkerEvent } from '@vozella/contracts';
import { describe, expect, it } from 'vitest';
import { createAsrWorker } from './asr-worker-core';
import type { NativeHandle, NemoLibrary, RecognizerConfigDto } from './nemo-library';

class FakeLibrary implements NemoLibrary {
  readonly version = 'nemo 0.3.0';
  readonly calls: string[] = [];
  results: AsrResultDto[] = [];
  createError: Error | null = null;
  lastConfig: RecognizerConfigDto | null = null;
  private counter = 0;

  createRecognizer(config: RecognizerConfigDto): NativeHandle {
    if (this.createError) throw this.createError;
    this.lastConfig = config;
    this.counter += 1;
    this.calls.push(`create r${String(this.counter)}`);
    return { id: `r${String(this.counter)}` };
  }
  destroyRecognizer(recognizer: NativeHandle): void {
    this.calls.push(`destroy ${(recognizer as { id: string }).id}`);
  }
  startStream(recognizer: NativeHandle): NativeHandle {
    this.counter += 1;
    const id = `s${String(this.counter)}`;
    this.calls.push(`start ${id} on ${(recognizer as { id: string }).id}`);
    return { id };
  }
  pushF32(stream: NativeHandle, samples: Float32Array, sampleRate: number): void {
    this.calls.push(
      `push ${(stream as { id: string }).id} ${String(samples.length)}@${String(sampleRate)}`,
    );
  }
  next(): AsrResultDto | null {
    return this.results.shift() ?? null;
  }
  closeStream(stream: NativeHandle): void {
    this.calls.push(`close ${(stream as { id: string }).id}`);
  }
}

const settings = (binDirectory = 'C:/engine/bin') => ({
  modelPath: 'C:/m.gguf',
  binDirectory,
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
  latency: 'live' as const,
});

function setup(koffi: () => Promise<string> = () => Promise.resolve('3.3.6')) {
  const events: AsrWorkerEvent[] = [];
  const library = new FakeLibrary();
  const opened: string[] = [];
  const openLibrary = (dir: string): NemoLibrary => {
    opened.push(dir);
    return library;
  };
  const handle = createAsrWorker({ koffiVersion: koffi, openLibrary, post: (e) => events.push(e) });
  let nextId = 1;
  const rpc = async (call: AsrRpcCall) => {
    const id = nextId++;
    await handle({ type: 'rpc', id, call });
    return events.at(-1) as Extract<AsrWorkerEvent, { type: 'rpc-result' }>;
  };
  return { events, library, opened, handle, rpc };
}

describe('asr worker core', () => {
  it('reports the koffi version on ping, and a broken koffi as null', async () => {
    const ok = setup();
    await ok.handle({ type: 'ping' });
    await Promise.resolve();
    await Promise.resolve();
    expect(ok.events).toEqual([{ type: 'pong', koffi: '3.3.6' }]);
    const broken = setup(() => Promise.reject(new Error('cannot find module')));
    await broken.handle({ type: 'ping' });
    await new Promise((r) => setTimeout(r, 0));
    expect(broken.events).toEqual([{ type: 'pong', koffi: null }]);
  });

  it('loads the engine from the given folder and reports its version', async () => {
    const { events, handle, opened } = setup();
    await handle({ type: 'load', binDir: 'C:/engine' });
    expect(opened).toEqual(['C:/engine']);
    expect(events).toEqual([{ type: 'loaded', version: 'nemo 0.3.0' }]);
  });

  it('reports load failures as error events and retries on the next call', async () => {
    const events: AsrWorkerEvent[] = [];
    let attempts = 0;
    const handle = createAsrWorker({
      koffiVersion: () => Promise.resolve('3'),
      openLibrary: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('Cannot find shared library');
        return new FakeLibrary();
      },
      post: (e) => events.push(e),
    });
    await handle({ type: 'load', binDir: 'C:/nope' });
    await handle({ type: 'load', binDir: 'C:/nope' });
    expect(events[0]).toEqual({ type: 'error', message: 'Cannot find shared library' });
    expect(events[1]).toEqual({ type: 'loaded', version: 'nemo 0.3.0' });
  });

  it('rejects invalid commands', async () => {
    const { events, handle } = setup();
    await handle({ type: 'load' });
    expect(events).toEqual([{ type: 'error', message: 'invalid command' }]);
  });

  it('loads a folder once and shares the library between recognizers', async () => {
    const { rpc, opened } = setup();
    await rpc({ method: 'createRecognizer', recognizerId: 'a', settings: settings() });
    await rpc({
      method: 'createRecognizer',
      recognizerId: 'b',
      settings: settings('C:/ENGINE/bin'),
    });
    await rpc({
      method: 'createRecognizer',
      recognizerId: 'c',
      settings: settings('C:/other/bin'),
    });
    expect(opened).toEqual(['C:/engine/bin', 'C:/other/bin']);
  });

  it('maps the latency profile to the encoder right context', async () => {
    const { rpc, library } = setup();
    await rpc({ method: 'createRecognizer', recognizerId: 'live', settings: settings() });
    expect(library.lastConfig?.rnntRightContext).toBe(3);
    await rpc({
      method: 'createRecognizer',
      recognizerId: 'off',
      settings: { ...settings(), latency: 'offline' },
    });
    expect(library.lastConfig?.rnntRightContext).toBe(13);
  });

  it('pushes samples and drains every available result, copied', async () => {
    const { rpc, library } = setup();
    await rpc({ method: 'createRecognizer', recognizerId: 'r', settings: settings() });
    await rpc({
      method: 'startStream',
      streamId: 's',
      recognizerId: 'r',
      options: { language: 'es-US', interimResults: true, diarization: false },
    });
    const pushed = await rpc({
      method: 'push',
      streamId: 's',
      samples: new Float32Array(1600),
      sampleRate: 16_000,
    });
    expect(pushed.ok).toBe(true);
    library.results = [
      { isFinal: false, transcript: 'a', audioProcessedSeconds: 0.1, words: [] },
      { isFinal: true, transcript: 'b', audioProcessedSeconds: 0.2, words: [] },
    ];
    const pulled = await rpc({ method: 'pull', streamId: 's' });
    expect((pulled.result as AsrResultDto[]).map((r) => r.transcript)).toEqual(['a', 'b']);
    expect(((await rpc({ method: 'pull', streamId: 's' })).result as unknown[]).length).toBe(0);
  });

  it('disposes streams before their recognizer, each once', async () => {
    const { rpc, library } = setup();
    await rpc({ method: 'createRecognizer', recognizerId: 'r', settings: settings() });
    await rpc({
      method: 'startStream',
      streamId: 's',
      recognizerId: 'r',
      options: { language: 'auto', interimResults: true, diarization: false },
    });
    await rpc({ method: 'disposeRecognizer', recognizerId: 'r' });
    await rpc({ method: 'disposeRecognizer', recognizerId: 'r' });
    await rpc({ method: 'disposeStream', streamId: 's' });
    expect(library.calls.filter((c) => c.startsWith('close') || c.startsWith('destroy'))).toEqual([
      'close s2',
      'destroy r1',
    ]);
  });

  it('reports a native failure as a failed result and keeps serving', async () => {
    const { rpc, library } = setup();
    library.createError = new Error('nemo_speech_asr_create failed: bad model');
    const failed = await rpc({
      method: 'createRecognizer',
      recognizerId: 'r',
      settings: settings(),
    });
    expect(failed).toMatchObject({
      ok: false,
      message: 'nemo_speech_asr_create failed: bad model',
    });
    library.createError = null;
    expect(
      (await rpc({ method: 'createRecognizer', recognizerId: 'r', settings: settings() })).ok,
    ).toBe(true);
  });

  it('refuses calls on unknown handles and duplicate ids', async () => {
    const { rpc } = setup();
    expect((await rpc({ method: 'pull', streamId: 'nope' })).ok).toBe(false);
    expect(
      (
        await rpc({
          method: 'startStream',
          streamId: 's',
          recognizerId: 'nope',
          options: { language: 'auto', interimResults: true, diarization: false },
        })
      ).ok,
    ).toBe(false);
    await rpc({ method: 'createRecognizer', recognizerId: 'r', settings: settings() });
    expect(
      (await rpc({ method: 'createRecognizer', recognizerId: 'r', settings: settings() })).ok,
    ).toBe(false);
  });

  it('closes everything on shutdown but never unloads the library', async () => {
    const { rpc, library, handle } = setup();
    await rpc({ method: 'createRecognizer', recognizerId: 'r', settings: settings() });
    await handle({ type: 'shutdown' });
    expect(library.calls).toContain('destroy r1');
  });
});
