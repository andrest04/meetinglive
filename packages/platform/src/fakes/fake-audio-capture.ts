import type {
  AudioCapturePort,
  AudioFrame,
  AudioSource,
  CaptureSession,
  CaptureStats,
  CaptureStopped,
} from '@vozella/core';

const SAMPLES_PER_FRAME = 320; // 20 ms at 16 kHz
const FRAME_MS = 20;

export interface FakeAudioCaptureOptions {
  /** Sine frequency in Hz. 0 produces silence. Default 440. */
  readonly toneHz?: number;
  /** Make start() reject, to test failure paths. */
  readonly failWith?: string;
}

/** Fake: a deterministic tone (or silence) on the same 20 ms cadence as the real device. */
export class FakeAudioCapture implements AudioCapturePort {
  readonly started: AudioSource[] = [];
  /** The stop callbacks handed to `start`, so a test can end a source by itself. */
  readonly stopCallbacks: { source: AudioSource; onStopped?: CaptureStopped }[] = [];

  constructor(private readonly options: FakeAudioCaptureOptions = {}) {}

  start(
    source: AudioSource,
    onFrame: (frame: AudioFrame) => void,
    onStopped?: CaptureStopped,
  ): Promise<CaptureSession> {
    if (this.options.failWith) {
      return Promise.reject(new Error(this.options.failWith));
    }
    this.started.push(source);
    this.stopCallbacks.push({ source, onStopped });
    const toneHz = this.options.toneHz ?? 440;
    let frames = 0;
    const timer = setInterval(() => {
      onFrame({
        pcm: tonePcm(toneHz, frames),
        tsMs: frames * FRAME_MS,
        synthesized: toneHz === 0,
      });
      frames += 1;
    }, FRAME_MS);
    let stopped = false;
    return Promise.resolve({
      stop(): CaptureStats {
        if (!stopped) {
          stopped = true;
          clearInterval(timer);
        }
        const samples = frames * SAMPLES_PER_FRAME;
        return {
          frames,
          realSamples: toneHz === 0 ? 0 : samples,
          synthesizedSamples: toneHz === 0 ? samples : 0,
          packets: frames,
          silentFlagPackets: 0,
          discontinuities: 0,
        };
      },
    });
  }
}

function tonePcm(toneHz: number, frameIndex: number): Uint8Array {
  const out = new Uint8Array(SAMPLES_PER_FRAME * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < SAMPLES_PER_FRAME; i += 1) {
    const n = frameIndex * SAMPLES_PER_FRAME + i;
    const sample = toneHz === 0 ? 0 : Math.sin((2 * Math.PI * toneHz * n) / 16_000) * 0.5;
    view.setInt16(i * 2, Math.round(sample * 32767), true);
  }
  return out;
}
