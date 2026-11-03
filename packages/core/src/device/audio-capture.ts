/** Port: capture of one audio source as 16 kHz mono PCM16 in 20 ms frames. */

export type AudioSource =
  | { readonly kind: 'mic' }
  | { readonly kind: 'system' }
  | { readonly kind: 'process'; readonly pid: number; readonly includeTree: boolean };

export interface AudioFrame {
  /** 320 samples, PCM16 little-endian (640 bytes). */
  readonly pcm: Uint8Array;
  /** Media time of the first sample, in ms since the stream started. */
  readonly tsMs: number;
  /** True when part of the frame was synthesized because the device sent nothing. */
  readonly synthesized: boolean;
}

export interface CaptureStats {
  readonly frames: number;
  readonly realSamples: number;
  readonly synthesizedSamples: number;
  readonly packets: number;
  readonly silentFlagPackets: number;
  readonly discontinuities: number;
}

export interface CaptureSession {
  /** Stops capture and returns the counters. Safe to call once. */
  stop(): CaptureStats;
}

export interface AudioCapturePort {
  /** Resolves once the device is initialised; rejects if it cannot be opened. */
  start(source: AudioSource, onFrame: (frame: AudioFrame) => void): Promise<CaptureSession>;
}
