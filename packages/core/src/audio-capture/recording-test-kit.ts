import type { CancelSignal } from '../cancel';
import type {
  AudioCapturePort,
  AudioFrame,
  AudioSource,
  CaptureSession,
  CaptureStats,
  CaptureStopped,
} from '../device/audio-capture';
import type { PumpClock, WavWriter } from './recording-service';

/** Test helper: virtual time that tests move by hand. */
export class ManualPumpClock implements PumpClock {
  private time = 0;
  private sleepers: { wakeAt: number; resolve: () => void }[] = [];

  nowMs(): number {
    return this.time;
  }

  sleep(ms: number, cancel: CancelSignal): Promise<void> {
    if (cancel.cancelled) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const sleeper = { wakeAt: this.time + ms, resolve };
      this.sleepers.push(sleeper);
      cancel.onCancel(() => {
        this.sleepers = this.sleepers.filter((s) => s !== sleeper);
        resolve();
      });
    });
  }

  /** Time passes without anyone sleeping: work that took long. */
  jump(ms: number): void {
    this.time += ms;
  }

  /** Moves time forward in small steps, letting woken code run between steps. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    await flush();
    for (;;) {
      const next = this.sleepers.reduce<number | undefined>(
        (min, s) => (min === undefined || s.wakeAt < min ? s.wakeAt : min),
        undefined,
      );
      if (next === undefined || next > end) break;
      this.time = Math.max(this.time, next);
      const due = this.sleepers.filter((s) => s.wakeAt <= this.time);
      this.sleepers = this.sleepers.filter((s) => s.wakeAt > this.time);
      for (const s of due) s.resolve();
      await flush();
    }
    this.time = end;
    await flush();
  }
}

/** Lets pending promise continuations run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 25; i += 1) await Promise.resolve();
}

export class FakeCaptureSession implements CaptureSession {
  stopCalls = 0;
  stopError: Error | undefined;
  readonly stopStats: CaptureStats = {
    frames: 0,
    realSamples: 0,
    synthesizedSamples: 0,
    packets: 0,
    silentFlagPackets: 0,
    discontinuities: 0,
  };

  constructor(
    readonly source: AudioSource,
    private readonly onFrame: (frame: AudioFrame) => void,
    private readonly onStopped: CaptureStopped | undefined,
  ) {}

  stop(): CaptureStats {
    this.stopCalls += 1;
    if (this.stopError) throw this.stopError;
    return this.stopStats;
  }

  /** Delivers `samples` of a constant PCM16 value as 20 ms frames. */
  emit(value: number, samples = 320): void {
    const pcm = new Uint8Array(samples * 2);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < samples; i += 1) view.setInt16(i * 2, value, true);
    this.onFrame({ pcm, tsMs: 0, synthesized: false });
  }

  /** The device stops by itself. */
  die(error: Error | null): void {
    this.onStopped?.(error);
  }
}

export class FakeCapturePort implements AudioCapturePort {
  readonly sessions: FakeCaptureSession[] = [];
  failOn: 'mic' | 'system' | 'process' | undefined;
  startError = new Error('device failed');

  start(
    source: AudioSource,
    onFrame: (frame: AudioFrame) => void,
    onStopped?: CaptureStopped,
  ): Promise<CaptureSession> {
    if (this.failOn === source.kind) return Promise.reject(this.startError);
    const session = new FakeCaptureSession(source, onFrame, onStopped);
    this.sessions.push(session);
    return Promise.resolve(session);
  }

  get mic(): FakeCaptureSession | undefined {
    return this.sessions.find((s) => s.source.kind === 'mic');
  }

  get output(): FakeCaptureSession | undefined {
    return this.sessions.find((s) => s.source.kind !== 'mic');
  }
}

export class FakeWavWriter implements WavWriter {
  readonly chunks: Uint8Array[] = [];
  flushes = 0;
  closes = 0;
  writeError: Error | undefined;
  flushError: Error | undefined;
  closeError: Error | undefined;
  /** Writes fail once this many bytes are stored: a full disk. */
  diskLimit = Number.POSITIVE_INFINITY;

  get bytes(): number {
    return this.chunks.reduce((n, c) => n + c.byteLength, 0);
  }

  write(pcm: Uint8Array): void {
    if (this.writeError) throw this.writeError;
    if (this.bytes + pcm.byteLength > this.diskLimit) throw new Error('disk full');
    this.chunks.push(pcm);
  }

  flush(): void {
    this.flushes += 1;
    if (this.flushError) throw this.flushError;
  }

  close(): void {
    this.closes += 1;
    if (this.closeError) throw this.closeError;
  }

  /** All written samples as one array. */
  samples(): Int16Array {
    const all = new Uint8Array(this.bytes);
    let offset = 0;
    for (const c of this.chunks) {
      all.set(c, offset);
      offset += c.byteLength;
    }
    return new Int16Array(all.buffer);
  }
}
