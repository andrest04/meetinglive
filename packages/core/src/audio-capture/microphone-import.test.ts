import { describe, expect, it } from 'vitest';
import { CancelSource } from '../cancel';
import {
  AudioFileNotFoundError,
  AudioImportService,
  ImportCancelledError,
  importRecordedAt,
  type AudioFileDecoder,
} from './import-service';
import { MicrophoneLevelPreview } from './microphone-preview';
import {
  FakeCapturePort,
  FakeWavWriter,
  flush,
  type FakeCaptureSession,
} from './recording-test-kit';

describe('MicrophoneLevelPreview', () => {
  function rig() {
    const port = new FakeCapturePort();
    const levels: number[] = [];
    return { port, levels, preview: new MicrophoneLevelPreview(port, (l) => levels.push(l)) };
  }

  it('raises the RMS level of each frame', async () => {
    const { port, levels, preview } = rig();
    await preview.start('dev');
    expect(port.sessions[0]?.source).toEqual({ kind: 'mic', deviceId: 'dev' });
    port.sessions[0]?.emit(16384);
    expect(levels[0]).toBeCloseTo(0.5, 3);
  });

  it('does not throw when the capture cannot be created, and a later start works', async () => {
    const { port, preview } = rig();
    port.failOn = 'mic';
    await expect(preview.start(null)).resolves.toBeUndefined();
    port.failOn = undefined;
    await preview.start(null);
    expect(port.sessions).toHaveLength(1);
    preview.stop();
    expect(port.sessions[0]?.stopCalls).toBe(1);
  });

  it('stops the previous preview first and stop is idempotent', async () => {
    const { port, preview } = rig();
    await preview.start(null);
    await preview.start('b');
    expect(port.sessions[0]?.stopCalls).toBe(1);
    preview.stop();
    preview.stop();
    expect(port.sessions[1]?.stopCalls).toBe(1);
    new MicrophoneLevelPreview(port, () => undefined).stop();
  });

  it('releases the capture and raises level 0 when the device stops itself', async () => {
    const { port, levels, preview } = rig();
    await preview.start(null);
    port.sessions[0]?.die(new Error('unplugged'));
    expect(levels.at(-1)).toBe(0);
    preview.stop();
    expect(port.sessions[0]?.stopCalls).toBe(1);
  });

  it('S4: two overlapping starts leave exactly one running capture', async () => {
    const port = new FakeCapturePort();
    const gates: (() => void)[] = [];
    const slow = {
      start: (...args: Parameters<FakeCapturePort['start']>) =>
        new Promise((resolve) => {
          gates.push(() => {
            void port.start(...args).then(resolve);
          });
        }),
    } as unknown as FakeCapturePort;
    const preview = new MicrophoneLevelPreview(slow, () => undefined);
    const first = preview.start('a');
    const second = preview.start('b');
    gates[1]?.();
    await second;
    gates[0]?.();
    await first;
    await flush();
    const running = port.sessions.filter((s: FakeCaptureSession) => s.stopCalls === 0);
    expect(running).toHaveLength(1);
    expect(running[0]?.source).toEqual({ kind: 'mic', deviceId: 'b' });
  });
});

describe('AudioImportService', () => {
  function rig(opts: { chunks?: Uint8Array[]; exists?: boolean; openError?: Error } = {}) {
    const writer = new FakeWavWriter();
    const removed: string[] = [];
    const dirs: string[] = [];
    let closed = 0;
    const chunks = [...(opts.chunks ?? [new Uint8Array(640)])];
    const decoder: AudioFileDecoder = {
      read: () => chunks.shift() ?? null,
      close: () => {
        closed += 1;
      },
    };
    const service = new AudioImportService({
      fileExists: () => opts.exists ?? true,
      ensureParentDirectory: (p) => dirs.push(p),
      openDecoder: () => {
        if (opts.openError) throw opts.openError;
        return decoder;
      },
      createWriter: () => writer,
      removeFile: (p) => removed.push(p),
      yieldToEventLoop: () => Promise.resolve(),
    });
    return { service, writer, removed, dirs, closed: () => closed };
  }

  it('writes the decoded audio, flushes the header and closes everything', async () => {
    const r = rig({ chunks: [new Uint8Array(640), new Uint8Array(320)] });
    await r.service.convertToNemotronWav('in.mp3', 'out.wav');
    expect(r.writer.bytes).toBe(960);
    expect(r.writer.flushes).toBe(1);
    expect(r.writer.closes).toBe(1);
    expect(r.closed()).toBe(1);
    expect(r.dirs).toEqual(['out.wav']);
    expect(r.removed).toEqual([]);
  });

  it('rejects blank paths', async () => {
    const r = rig();
    await expect(r.service.convertToNemotronWav('  ', 'o.wav')).rejects.toThrow();
    await expect(r.service.convertToNemotronWav('i.wav', '')).rejects.toThrow();
  });

  it('throws file not found and creates nothing for a missing source', async () => {
    const r = rig({ exists: false });
    await expect(r.service.convertToNemotronWav('in.wav', 'o.wav')).rejects.toThrow(
      AudioFileNotFoundError,
    );
    await expect(r.service.convertToNemotronWav('in.wav', 'o.wav')).rejects.toThrow(
      'The audio file was not found.',
    );
    expect(r.dirs).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('throws on zero samples and deletes the destination', async () => {
    const r = rig({ chunks: [] });
    await expect(r.service.convertToNemotronWav('in.wav', 'o.wav')).rejects.toThrow(
      'The audio file contained no samples.',
    );
    expect(r.removed).toEqual(['o.wav']);
    expect(r.writer.closes).toBe(1);
  });

  it('deletes the destination when the file cannot be decoded', async () => {
    const r = rig({ openError: new Error('no decoder') });
    await expect(r.service.convertToNemotronWav('in.bin', 'o.wav')).rejects.toThrow('no decoder');
    expect(r.removed).toEqual(['o.wav']);
  });

  it('honors cancellation between buffers and deletes the partial file', async () => {
    const cancel = new CancelSource();
    const r = rig({ chunks: [new Uint8Array(640), new Uint8Array(640), new Uint8Array(640)] });
    const original = r.writer.write.bind(r.writer);
    r.writer.write = (pcm) => {
      original(pcm);
      cancel.cancel();
    };
    await expect(r.service.convertToNemotronWav('in.wav', 'o.wav', cancel)).rejects.toThrow(
      ImportCancelledError,
    );
    expect(r.writer.bytes).toBe(640);
    expect(r.removed).toEqual(['o.wav']);
  });
});

describe('importRecordedAt', () => {
  it('uses the last-write time, now when unreadable or the minimum value', () => {
    expect(importRecordedAt(5000, 9000)).toBe(5000);
    expect(importRecordedAt(null, 9000)).toBe(9000);
    expect(importRecordedAt(0, 9000)).toBe(9000);
    expect(importRecordedAt(Number.NaN, 9000)).toBe(9000);
  });
});
