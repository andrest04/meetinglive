import { describe, expect, it } from 'vitest';
import { systemLoopbackSources, processTreeSources } from './capture-sources';
import { assertProcessLoopbackSupported, ProcessLoopbackUnsupportedError } from './ports';
import {
  AudioCaptureService,
  PUMP_CHUNK_BYTES,
  type PcmFrame,
  type SourceLostEvent,
} from './recording-service';
import { FakeCapturePort, FakeWavWriter, ManualPumpClock, flush } from './recording-test-kit';

interface Rig {
  service: AudioCaptureService;
  readonly port: FakeCapturePort;
  readonly writer: FakeWavWriter;
  readonly clock: ManualPumpClock;
  readonly lost: SourceLostEvent[];
  readonly outputFailed: Error[];
  readonly faulted: Error[];
  readonly frames: PcmFrame[];
  readonly removed: string[];
  readonly repaired: string[];
}

function rig(): Rig {
  const port = new FakeCapturePort();
  const writer = new FakeWavWriter();
  const clock = new ManualPumpClock();
  const removed: string[] = [];
  const repaired: string[] = [];
  const service = new AudioCaptureService({
    sources: port,
    clock,
    createWriter: () => writer,
    removeFile: (p) => removed.push(p),
    repairWav: (p) => repaired.push(p),
  });
  const r: Rig = {
    service,
    port,
    writer,
    clock,
    lost: [],
    outputFailed: [],
    faulted: [],
    frames: [],
    removed,
    repaired,
  };
  service.setListeners({
    onFrame: (f) => r.frames.push(f),
    onSourceLost: (e) => r.lost.push(e),
    onOutputCaptureFailed: (e) => r.outputFailed.push(e),
    onFaulted: (e) => r.faulted.push(e),
  });
  return r;
}

/** Feeds 200 ms of a constant to a session. */
function feed(session: { emit(v: number, n?: number): void } | undefined, value: number): void {
  for (let i = 0; i < 10; i += 1) session?.emit(value);
}

const withMic = systemLoopbackSources(true, null);
const systemOnly = systemLoopbackSources(false, null);

describe('AudioCaptureService start', () => {
  it('rejects an invalid request before touching a device', async () => {
    const r = rig();
    await expect(r.service.start('a.wav', { ...withMic, processId: 5 })).rejects.toThrow(
      'System loopback cannot also target a process.',
    );
    expect(r.port.sessions).toHaveLength(0);
  });

  it('C7: refuses a process capture with a clear error before any device opens', async () => {
    const r = rig();
    const gated = new AudioCaptureService({
      sources: r.port,
      clock: r.clock,
      createWriter: () => r.writer,
      removeFile: () => undefined,
      repairWav: () => undefined,
      preflight: (s) => {
        if (s.output === 'ProcessTree') assertProcessLoopbackSupported(19045);
      },
    });
    await expect(gated.start('a.wav', processTreeSources(true, null, 4242))).rejects.toThrow(
      ProcessLoopbackUnsupportedError,
    );
    expect(r.port.sessions).toHaveLength(0);
    await gated.start('a.wav', withMic);
    expect(gated.isRecording).toBe(true);
  });

  it('throws while a recording is in progress, also during a stop', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    await expect(r.service.start('b.wav', withMic)).rejects.toThrow(
      'A recording is already in progress.',
    );
    const stopping = r.service.stop();
    expect(r.service.isRecording).toBe(true);
    await expect(r.service.start('b.wav', withMic)).rejects.toThrow(
      'A recording is already in progress.',
    );
    await stopping;
    expect(r.service.isRecording).toBe(false);
  });

  it('opens the mic first with its device id, then exactly one output', async () => {
    const r = rig();
    await r.service.start('a.wav', systemLoopbackSources(true, 'dev-1'));
    expect(r.port.sessions.map((s) => s.source)).toEqual([
      { kind: 'mic', deviceId: 'dev-1' },
      { kind: 'system' },
    ]);
  });

  it('opens no microphone when it is off, whatever the id', async () => {
    const r = rig();
    await r.service.start('a.wav', systemLoopbackSources(false, 'dev-1'));
    expect(r.port.sessions.map((s) => s.source.kind)).toEqual(['system']);
  });

  it('captures one process tree and never system loopback', async () => {
    const r = rig();
    await r.service.start('a.wav', processTreeSources(false, null, 4242));
    expect(r.port.sessions.map((s) => s.source)).toEqual([
      { kind: 'process', pid: 4242, includeTree: true },
    ]);
  });

  it('cleans up, deletes the file and rethrows when a device fails to start (C1)', async () => {
    const r = rig();
    r.port.failOn = 'system';
    await expect(r.service.start('a.wav', withMic)).rejects.toThrow('device failed');
    expect(r.port.mic?.stopCalls).toBe(1);
    expect(r.writer.closes).toBe(1);
    expect(r.removed).toEqual(['a.wav']);
    expect(r.service.isRecording).toBe(false);
    // The instance is reusable.
    r.port.failOn = undefined;
    await r.service.start('b.wav', withMic);
    expect(r.service.isRecording).toBe(true);
  });

  it('swallows errors of the abort steps and still throws the original', async () => {
    const r = rig();
    r.port.failOn = 'system';
    r.writer.closeError = new Error('close failed');
    await expect(r.service.start('a.wav', withMic)).rejects.toThrow('device failed');
    expect(r.removed).toEqual(['a.wav']);
  });
});

describe('mixing and file output', () => {
  it('writes 6400 byte chunks paced against the clock', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await flush();
    expect(r.writer.chunks).toHaveLength(1);
    expect(r.writer.chunks[0]?.byteLength).toBe(PUMP_CHUNK_BYTES);
    await r.clock.advance(1000);
    // One chunk at t=0, then one per 200 ms: 6 by t=1000.
    expect(r.writer.chunks).toHaveLength(6);
    expect(r.writer.bytes).toBe(6 * PUMP_CHUNK_BYTES);
  });

  it('catches up without sleeping when it falls behind, yielding between chunks', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await r.clock.advance(400);
    expect(r.writer.chunks).toHaveLength(3);
    // The disk stalls for one second: the pump is 5 chunks behind.
    r.clock.jump(1000);
    await r.clock.advance(0);
    expect(r.writer.chunks).toHaveLength(8);
    // Caught up: back to one chunk per 200 ms.
    await r.clock.advance(200);
    expect(r.writer.chunks).toHaveLength(9);
  });

  it('lets audio that arrived while catching up reach the buffers before the next read', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await flush();
    r.clock.jump(600);
    r.port.output?.emit(5000, 3200);
    await r.clock.advance(0);
    // The burst reads the data that arrived, it does not write silence over it.
    expect(r.writer.samples().includes(5000)).toBe(true);
  });

  it('fills with silence where a source delivered nothing', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await r.clock.advance(400);
    expect(r.writer.samples().every((s) => s === 0)).toBe(true);
  });

  it('sums the sources with no attenuation and clamps to full scale', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    await flush();
    feed(r.port.mic, 20000);
    feed(r.port.output, 20000);
    await r.clock.advance(200);
    const second = new Int16Array(r.writer.chunks[1]!.buffer.slice(r.writer.chunks[1]!.byteOffset));
    expect(second[0]).toBe(32767);
    feed(r.port.mic, 1000);
    feed(r.port.output, 2000);
    await r.clock.advance(200);
    const third = new Int16Array(r.writer.chunks[2]!.buffer.slice(r.writer.chunks[2]!.byteOffset));
    expect(third[0]).toBe(3000);
  });

  it('keeps the output when the microphone is lost', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    await flush();
    r.port.mic?.die(new Error('unplugged'));
    feed(r.port.output, 5000);
    await r.clock.advance(200);
    expect(r.frames.at(-1)?.samples.some((s) => s > 0.1)).toBe(true);
  });

  it('drops source data that does not fit in 5 seconds and pads on underrun', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await flush();
    // 6 s of data into a 5 s buffer: the newest second is dropped.
    for (let i = 0; i < 300; i += 1) r.port.output?.emit(1000);
    await r.clock.advance(6000);
    const all = r.writer.samples();
    expect(all.slice(0, 16_000 * 5).every((s) => s === 1000 || s === 0)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(16_000 * 6);
    expect(all.slice(16_000 * 5 + 3200).every((s) => s === 0)).toBe(true);
  });

  it('raises float frames equal to the file, only for a subscriber', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await flush();
    feed(r.port.output, 16384);
    await r.clock.advance(200);
    const frame = r.frames[1];
    expect(frame?.sampleRate).toBe(16_000);
    expect(frame?.samples).toHaveLength(3200);
    expect(frame?.samples[0]).toBeCloseTo(16384 / 32768, 3);

    const quiet = rig();
    quiet.service.setListeners({});
    await quiet.service.start('a.wav', systemOnly);
    await quiet.clock.advance(400);
    expect(quiet.frames).toHaveLength(0);
    expect(quiet.writer.chunks.length).toBeGreaterThan(1);
  });

  it('flushes the header every 160000 written bytes, not when paused', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await r.clock.advance(4600);
    expect(r.writer.flushes).toBe(0);
    await r.clock.advance(200);
    expect(r.writer.flushes).toBe(1);
    r.service.pause();
    await r.clock.advance(20_000);
    expect(r.writer.flushes).toBe(1);
  });

  it('ignores an IO error of a periodic flush', async () => {
    const r = rig();
    r.writer.flushError = new Error('io');
    await r.service.start('a.wav', systemOnly);
    await r.clock.advance(5200);
    expect(r.faulted).toHaveLength(0);
    expect(r.service.isRecording).toBe(true);
  });
});

describe('microphone level (fixes C4)', () => {
  it('reports the microphone alone, once per 100 ms, and never from the output', async () => {
    const r = rig();
    const levels: number[] = [];
    r.service.setListeners({ onMicrophoneLevel: (l) => levels.push(l) });
    await r.service.start('a.wav', withMic);
    for (let i = 0; i < 5; i += 1) r.port.output?.emit(30000);
    expect(levels).toEqual([]);
    for (let i = 0; i < 5; i += 1) r.port.mic?.emit(16384);
    expect(levels).toHaveLength(1);
    expect(levels[0]).toBeCloseTo(0.5, 2);
  });

  it('stays silent with no microphone and while paused', async () => {
    const r = rig();
    const levels: number[] = [];
    r.service.setListeners({ onMicrophoneLevel: (l) => levels.push(l) });
    await r.service.start('a.wav', systemOnly);
    for (let i = 0; i < 20; i += 1) r.port.output?.emit(30000);
    expect(levels).toEqual([]);
    await r.service.stop();
    await r.service.start('b.wav', withMic);
    r.service.pause();
    for (let i = 0; i < 10; i += 1) r.port.mic?.emit(30000);
    expect(levels).toEqual([]);
  });
});

describe('pause and resume', () => {
  it('is a no-op when not recording', () => {
    const r = rig();
    r.service.pause();
    expect(r.service.isPaused).toBe(false);
    r.service.resume();
    expect(r.service.isPaused).toBe(false);
  });

  it('writes nothing while paused and does not record the break', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await r.clock.advance(1000);
    const before = r.writer.bytes;
    const framesBefore = r.frames.length;
    r.service.pause();
    expect(r.service.isPaused).toBe(true);
    feed(r.port.output, 9000);
    await r.clock.advance(10_000);
    expect(r.writer.bytes).toBe(before);
    expect(r.frames).toHaveLength(framesBefore);
    r.service.resume();
    await r.clock.advance(1000);
    // Duration tracks wall time minus the pause: 2 s recorded plus the first chunk.
    const seconds = r.writer.bytes / 32000;
    expect(seconds).toBeGreaterThanOrEqual(2);
    expect(seconds).toBeLessThanOrEqual(2.4);
    // Data that arrived during the break was drained, not written afterwards.
    expect(r.writer.samples().includes(9000)).toBe(false);
  });

  it('is cleared by stop', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    r.service.pause();
    await r.service.stop();
    expect(r.service.isPaused).toBe(false);
  });
});

describe('failures', () => {
  it('reports a microphone loss and keeps recording with the output', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    r.port.mic?.die(new Error('mic gone'));
    expect(r.lost.map((e) => [e.source, e.remaining])).toEqual([['Microphone', 1]]);
    expect(r.port.output?.stopCalls).toBe(0);
    expect(r.service.isRecording).toBe(true);
  });

  it('reports a system loopback loss and keeps recording with the microphone', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    r.port.output?.die(new Error('device invalidated'));
    expect(r.lost.map((e) => [e.source, e.remaining])).toEqual([['Output', 1]]);
    expect(r.service.isRecording).toBe(true);
    expect(r.outputFailed).toHaveLength(0);
  });

  it('says nothing is left after both sources are lost', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    r.port.mic?.die(new Error('a'));
    r.port.output?.die(new Error('b'));
    expect(r.lost.map((e) => e.remaining)).toEqual([1, 0]);
  });

  it('says nothing is left when the only source is lost', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    r.port.output?.die(new Error('a'));
    expect(r.lost.map((e) => e.remaining)).toEqual([0]);
  });

  it('never goes below zero remaining sources', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    r.port.output?.die(new Error('a'));
    r.port.output?.die(new Error('b'));
    expect(r.lost.map((e) => e.remaining)).toEqual([0, 0]);
  });

  it('keeps the existing stop behavior when a process output fails', async () => {
    const r = rig();
    await r.service.start('a.wav', processTreeSources(true, null, 4242));
    const failure = new Error('process capture died');
    r.port.output?.die(failure);
    expect(r.outputFailed).toEqual([failure]);
    expect(r.lost).toHaveLength(0);
    await expect(r.service.stop()).rejects.toBe(failure);
    expect(r.service.isRecording).toBe(false);
  });

  it('warns and keeps recording when the mic dies during a process capture', async () => {
    const r = rig();
    await r.service.start('a.wav', processTreeSources(true, null, 4242));
    r.port.mic?.die(new Error('mic gone'));
    expect(r.lost.map((e) => [e.source, e.remaining])).toEqual([['Microphone', 1]]);
    expect(r.outputFailed).toHaveLength(0);
    expect(r.service.isRecording).toBe(true);
  });

  it('never reports a user stop as a failure', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    await r.service.stop();
    expect(r.lost).toHaveLength(0);
    expect(r.outputFailed).toHaveLength(0);
    expect(r.faulted).toHaveLength(0);
    // Devices that report their own stop during teardown do not count either.
    r.port.mic?.die(new Error('late'));
    expect(r.lost).toHaveLength(0);
  });

  it('does nothing for an error-free stop of a device', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    r.port.mic?.die(null);
    expect(r.lost).toHaveLength(0);
  });
});

describe('pump faults', () => {
  it('reaches the caller while still recording, and stop rethrows and cleans up', async () => {
    const r = rig();
    r.writer.diskLimit = 7000;
    await r.service.start('a.wav', withMic);
    await r.clock.advance(400);
    expect(r.faulted).toHaveLength(1);
    expect(r.service.isRecording).toBe(true);
    await expect(r.service.stop()).rejects.toThrow('disk full');
    expect(r.service.isRecording).toBe(false);
    expect(r.port.mic?.stopCalls).toBe(1);
    expect(r.port.output?.stopCalls).toBe(1);
    expect(r.writer.closes).toBe(1);
    expect(r.writer.bytes).toBeGreaterThan(0);
  });

  it('lets a new recording start after a failed stop', async () => {
    const r = rig();
    r.writer.diskLimit = 7000;
    await r.service.start('a.wav', withMic);
    await r.clock.advance(400);
    await expect(r.service.stop()).rejects.toThrow('disk full');
    r.writer.diskLimit = Number.POSITIVE_INFINITY;
    await r.service.start('b.wav', withMic);
    expect(r.service.isRecording).toBe(true);
  });

  it('surfaces a throwing frame subscriber as a pump fault', async () => {
    const r = rig();
    const boom = new Error('subscriber failed');
    r.service.setListeners({
      onFrame: () => {
        throw boom;
      },
      onFaulted: (e) => r.faulted.push(e),
    });
    await r.service.start('a.wav', systemOnly);
    await flush();
    expect(r.faulted).toEqual([boom]);
    await expect(r.service.stop()).rejects.toBe(boom);
  });
});

describe('stop', () => {
  it('runs the rest of the teardown when one step fails and reports the error', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    r.port.mic!.stopError = new Error('mic stop failed');
    await expect(r.service.stop()).rejects.toThrow('mic stop failed');
    expect(r.port.output?.stopCalls).toBe(1);
    expect(r.writer.closes).toBe(1);
    expect(r.service.isRecording).toBe(false);
  });

  it('repairs the header when the writer fails to flush or close', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    r.writer.flushError = new Error('flush failed');
    await expect(r.service.stop()).rejects.toThrow('flush failed');
    expect(r.repaired).toEqual(['a.wav']);
  });

  it('tears down once for concurrent stops and gives every caller the same outcome', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    const stops = Array.from({ length: 8 }, () => r.service.stop());
    await Promise.all(stops);
    expect(r.port.mic?.stopCalls).toBe(1);
    expect(r.port.output?.stopCalls).toBe(1);
    expect(r.writer.closes).toBe(1);
  });

  it('gives every concurrent caller the same failure', async () => {
    const r = rig();
    r.writer.diskLimit = 7000;
    await r.service.start('a.wav', withMic);
    await r.clock.advance(400);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => r.service.stop()));
    const reasons = results.map((x) =>
      x.status === 'rejected' ? (x.reason as unknown) : undefined,
    );
    expect(reasons.every((x) => x === reasons[0] && x instanceof Error)).toBe(true);
  });

  it('does nothing and touches no device when not recording', async () => {
    const r = rig();
    await r.service.stop();
    expect(r.port.sessions).toHaveLength(0);
    expect(r.writer.closes).toBe(0);
  });

  it('can be stopped again after a fault without throwing', async () => {
    const r = rig();
    r.writer.diskLimit = 7000;
    await r.service.start('a.wav', withMic);
    await r.clock.advance(400);
    await expect(r.service.stop()).rejects.toThrow();
    await expect(r.service.stop()).resolves.toBeUndefined();
  });
});

describe('level window and teardown proof', () => {
  it('starts every take, and every pause and resume, with an empty 100 ms level window', async () => {
    const r = rig();
    const levels: number[] = [];
    r.service.setListeners({ onMicrophoneLevel: (l) => levels.push(l) });
    await r.service.start('a.wav', withMic);
    // Three loud frames, then a pause: the partial window must not leak into the resume.
    for (let i = 0; i < 3; i += 1) r.port.mic?.emit(30000);
    r.service.pause();
    r.service.resume();
    for (let i = 0; i < 4; i += 1) r.port.mic?.emit(0);
    expect(levels).toEqual([]);
    r.port.mic?.emit(0);
    expect(levels).toEqual([0]);
    // A stop mid-window does not carry into the next take either.
    for (let i = 0; i < 3; i += 1) r.port.mic?.emit(30000);
    await r.service.stop();
    r.port.sessions.length = 0;
    await r.service.start('b.wav', withMic);
    for (let i = 0; i < 5; i += 1) r.port.mic?.emit(0);
    expect(levels).toEqual([0, 0]);
  });

  it('lets a device that fails during start cancel the pump (item 36)', async () => {
    const r = rig();
    const original = r.port.start.bind(r.port);
    r.port.start = (source, onFrame, onStopped) => {
      if (source.kind === 'process') onStopped?.(new Error('device lost at once'));
      return original(source, onFrame, onStopped);
    };
    await r.service.start('a.wav', processTreeSources(false, null, 4242));
    expect(r.outputFailed.map((e) => e.message)).toEqual(['device lost at once']);
    await r.clock.advance(2000);
    expect(r.writer.chunks.length).toBeLessThanOrEqual(1);
  });

  it('tears down in the spec order: devices, pump, flush, close (item 42)', async () => {
    const r = rig();
    await r.service.start('a.wav', withMic);
    const order: string[] = [];
    const mic = r.port.mic!;
    const output = r.port.output!;
    const micStop = mic.stop.bind(mic);
    const outputStop = output.stop.bind(output);
    mic.stop = () => {
      order.push('mic');
      return micStop();
    };
    output.stop = () => {
      order.push('output');
      return outputStop();
    };
    const flushWriter = r.writer.flush.bind(r.writer);
    const closeWriter = r.writer.close.bind(r.writer);
    r.writer.flush = () => {
      order.push('flush');
      flushWriter();
    };
    r.writer.close = () => {
      order.push('close');
      closeWriter();
    };
    await r.service.stop();
    expect(order).toEqual(['mic', 'output', 'flush', 'close']);
  });

  it('does not write after the pump is awaited: nothing lands once flush has run (item 42)', async () => {
    const r = rig();
    await r.service.start('a.wav', systemOnly);
    await r.clock.advance(300);
    let afterFlush = -1;
    const flushWriter = r.writer.flush.bind(r.writer);
    r.writer.flush = () => {
      afterFlush = r.writer.chunks.length;
      flushWriter();
    };
    await r.service.stop();
    expect(r.writer.chunks).toHaveLength(afterFlush);
  });

  it('swallows a throwing microphone or output stop and a throwing file removal when a start aborts (item 35)', async () => {
    const r = rig();
    const original = r.port.start.bind(r.port);
    r.port.start = async (source, onFrame, onStopped) => {
      if (source.kind === 'system') throw new Error('device failed');
      const session = await original(source, onFrame, onStopped);
      session.stop = () => {
        throw new Error('mic stop failed');
      };
      return session;
    };
    r.service = new AudioCaptureService({
      sources: r.port,
      clock: r.clock,
      createWriter: () => r.writer,
      removeFile: () => {
        throw new Error('remove failed');
      },
      repairWav: () => undefined,
    });
    await expect(r.service.start('a.wav', withMic)).rejects.toThrow('device failed');
    expect(r.service.isRecording).toBe(false);
  });
});
