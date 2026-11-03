import type { AudioCapturePort, AudioFrame, CaptureSession } from '../device/audio-capture';
import type { CancelSignal } from '../cancel';
import { CancelSource } from '../cancel';
import {
  assertValidCaptureSources,
  effectiveMicrophoneId,
  isSourceLost,
  shouldSurfaceOutputFailure,
  usesSystemLoopback,
  type RecordingCaptureSources,
} from './capture-sources';
import { pcm16ToFloat } from './level-meter';
import { AudioMixer } from './mixer';
import { FILE_BYTES_PER_SECOND, WavHeaderFlushCadence } from './wav-format';

/** Spec 3.1.2. 200 ms of 16 kHz mono PCM16. */
export const PUMP_CHUNK_BYTES = FILE_BYTES_PER_SECOND / 5;
export const PUMP_CHUNK_SAMPLES = PUMP_CHUNK_BYTES / 2;
export const PAUSED_PUMP_SLEEP_MS = 50;
export const HEADER_FLUSH_SECONDS = 5;

/** Port: monotonic time and sleeping for the pump. Adapter: system timers in platform. */
export interface PumpClock {
  /** Milliseconds from any fixed origin, never going back. */
  nowMs(): number;
  /** Resolves after `ms`, or at once when `cancel` fires. */
  sleep(ms: number, cancel: CancelSignal): Promise<void>;
}

/** Port: the WAV file being written. All calls are synchronous so the pump keeps its pace. */
export interface WavWriter {
  write(pcm: Uint8Array): void;
  /** Rewrites the RIFF and data sizes and keeps the write position. */
  flush(): void;
  close(): void;
}

export type SourceKind = 'Microphone' | 'Output';

export interface SourceLostEvent {
  readonly source: SourceKind;
  /** Sources still delivering. Zero means only silence is being written. */
  readonly remaining: number;
  readonly error: Error;
}

/** A mixed frame: the same stream as the file, as float32 (spec 2.2.6). */
export interface PcmFrame {
  readonly samples: Float32Array;
  readonly sampleRate: number;
}

export interface RecordingServiceDeps {
  readonly sources: AudioCapturePort;
  readonly createWriter: (path: string) => WavWriter;
  /** Best effort: removes a file left by a failed start. */
  readonly removeFile: (path: string) => void;
  /** Repairs the header of a file whose writer failed to flush or close. */
  readonly repairWav: (path: string) => void;
  readonly clock: PumpClock;
}

export interface RecordingListeners {
  onFrame?(frame: PcmFrame): void;
  onSourceLost?(event: SourceLostEvent): void;
  /** Process-tree output failed: the recording ends, the caller stops it. */
  onOutputCaptureFailed?(error: Error): void;
  /** The pump died (full disk, throwing subscriber): the caller stops the recording. */
  onFaulted?(error: Error): void;
}

interface Handles {
  readonly mic: CaptureSession | undefined;
  readonly output: CaptureSession;
  readonly writer: WavWriter;
  readonly path: string;
}

/**
 * Records the microphone and one output to a 16 kHz mono PCM16 WAV (spec 2.2 and 2.3).
 * Sources deliver 20 ms frames already at 16 kHz mono; the pump mixes them in 200 ms
 * chunks paced by the wall clock.
 */
export class AudioCaptureService {
  private recording = false;
  private starting = false;
  private paused = false;
  private userStop = false;
  private outputFailure: Error | undefined;
  private pumpFailure: Error | undefined;
  private outputIsProcessCapture = false;
  private liveSources = 0;
  private cancel: CancelSource | undefined;
  private pump: Promise<void> | undefined;
  private handles: Handles | undefined;
  private stopTask: Promise<void> | undefined;
  private listeners: RecordingListeners = {};

  constructor(private readonly deps: RecordingServiceDeps) {}

  get isRecording(): boolean {
    return this.recording;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Subscribe before `start`: a device can fail the moment it starts. */
  setListeners(listeners: RecordingListeners): void {
    this.listeners = listeners;
  }

  async start(path: string, sources: RecordingCaptureSources): Promise<void> {
    assertValidCaptureSources(sources);
    if (this.recording || this.starting) throw new Error('A recording is already in progress.');

    this.paused = false;
    this.userStop = false;
    this.outputFailure = undefined;
    this.pumpFailure = undefined;
    this.outputIsProcessCapture = !usesSystemLoopback(sources);
    this.liveSources = sources.captureMicrophone ? 2 : 1;
    this.starting = true;

    const mixer = new AudioMixer();
    const cancel = new CancelSource();
    // Published before any device starts: a device may fail at once and cancel through it.
    this.cancel = cancel;
    let writer: WavWriter | undefined;
    let mic: CaptureSession | undefined;
    let output: CaptureSession | undefined;
    let pump: Promise<void> | undefined;
    try {
      writer = this.deps.createWriter(path);
      pump = this.runPump(mixer, writer, cancel);
      this.pump = pump;

      if (sources.captureMicrophone) {
        const input = mixer.addInput();
        mic = await this.deps.sources.start(
          { kind: 'mic', deviceId: effectiveMicrophoneId(sources) },
          (frame) => {
            input.push(frame.pcm);
          },
          (error) => {
            this.onSourceStopped('Microphone', error);
          },
        );
      }
      const outputInput = mixer.addInput();
      const pushOutput = (frame: AudioFrame): void => {
        outputInput.push(frame.pcm);
      };
      output = await this.deps.sources.start(
        usesSystemLoopback(sources)
          ? { kind: 'system' }
          : { kind: 'process', pid: sources.processId, includeTree: true },
        pushOutput,
        (error) => {
          this.onOutputStopped(error);
        },
      );
      this.handles = { mic, output, writer, path };
      this.recording = true;
    } catch (error) {
      await this.abortFailedStart({ cancel, pump, writer, mic, output, path });
      throw error;
    } finally {
      this.starting = false;
    }
  }

  pause(): void {
    if (this.recording) this.paused = true;
  }

  resume(): void {
    if (this.recording) this.paused = false;
  }

  /** Single flight: every caller gets the same task and the same outcome. */
  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    if (!this.recording) return Promise.resolve();
    this.stopTask = this.teardown();
    return this.stopTask;
  }

  private async teardown(): Promise<void> {
    const handles = this.handles;
    const cancel = this.cancel;
    const pump = this.pump;
    let teardownError: Error | undefined;
    const guard = async (step: () => unknown): Promise<void> => {
      try {
        await step();
      } catch (error) {
        teardownError ??= toError(error);
      }
    };

    this.userStop = true;
    await guard(() => handles?.mic?.stop());
    await guard(() => handles?.output.stop());
    cancel?.cancel();
    if (pump) {
      try {
        await pump;
      } catch (error) {
        teardownError ??= toError(error);
      }
    }
    let writerFailed = false;
    if (handles) {
      try {
        handles.writer.flush();
      } catch (error) {
        writerFailed = true;
        teardownError ??= toError(error);
      }
      try {
        handles.writer.close();
      } catch (error) {
        writerFailed = true;
        teardownError ??= toError(error);
      }
      if (writerFailed) {
        // The audio on disk is still the meeting: fix the header from the file length.
        try {
          this.deps.repairWav(handles.path);
        } catch {
          // Best effort.
        }
      }
    }
    this.handles = undefined;
    this.cancel = undefined;
    this.pump = undefined;
    this.paused = false;

    const failure = this.pumpFailure ?? this.outputFailure ?? teardownError;
    this.pumpFailure = undefined;
    this.outputFailure = undefined;
    this.recording = false;
    this.stopTask = undefined;
    if (failure) throw failure;
  }

  private async abortFailedStart(opened: {
    cancel: CancelSource;
    pump: Promise<void> | undefined;
    writer: WavWriter | undefined;
    mic: CaptureSession | undefined;
    output: CaptureSession | undefined;
    path: string;
  }): Promise<void> {
    // Detach first: what the abort stops below must not read as a failure.
    this.userStop = true;
    opened.cancel.cancel();
    if (opened.pump) {
      try {
        await opened.pump;
      } catch {
        // The original start error is what the caller needs.
      }
    }
    try {
      opened.writer?.close();
    } catch {
      // Swallowed on purpose.
    }
    for (const session of [opened.mic, opened.output]) {
      try {
        session?.stop();
      } catch {
        // Swallowed on purpose.
      }
    }
    if (opened.writer) {
      try {
        this.deps.removeFile(opened.path);
      } catch {
        // Fixes C1: a failed start no longer leaves a header-only file behind.
      }
    }
    this.cancel = undefined;
    this.pump = undefined;
    this.handles = undefined;
  }

  private onOutputStopped(error: Error | null): void {
    if (!shouldSurfaceOutputFailure(error, this.userStop, this.outputIsProcessCapture)) {
      this.reportSourceStopped('Output', error);
      return;
    }
    if (error === null) return;
    this.outputFailure = error;
    this.cancel?.cancel();
    this.listeners.onOutputCaptureFailed?.(error);
  }

  private onSourceStopped(source: SourceKind, error: Error | null): void {
    this.reportSourceStopped(source, error);
  }

  private reportSourceStopped(source: SourceKind, error: Error | null): void {
    if (error === null || !isSourceLost(error, this.userStop)) return;
    this.liveSources = Math.max(0, this.liveSources - 1);
    this.listeners.onSourceLost?.({ source, remaining: this.liveSources, error });
  }

  private async runPump(mixer: AudioMixer, writer: WavWriter, cancel: CancelSource): Promise<void> {
    const clock = this.deps.clock;
    const cadence = WavHeaderFlushCadence.forFormat(FILE_BYTES_PER_SECOND, HEADER_FLUSH_SECONDS);
    const startedAt = clock.nowMs();
    let bytesWritten = 0;
    let pauseAccumulatedMs = 0;
    let pauseStartedAt: number | undefined;
    try {
      while (!cancel.cancelled) {
        if (this.paused) {
          pauseStartedAt ??= clock.nowMs();
          // Drain and drop, so the source buffers do not overflow during the break.
          mixer.read(PUMP_CHUNK_SAMPLES);
          await clock.sleep(PAUSED_PUMP_SLEEP_MS, cancel);
          continue;
        }
        if (pauseStartedAt !== undefined) {
          pauseAccumulatedMs += clock.nowMs() - pauseStartedAt;
          pauseStartedAt = undefined;
        }
        const chunk = mixer.read(PUMP_CHUNK_SAMPLES);
        writer.write(chunk);
        bytesWritten += chunk.byteLength;
        if (cadence.shouldFlush(bytesWritten)) {
          try {
            writer.flush();
          } catch {
            // The final flush at stop retries.
          }
        }
        if (this.listeners.onFrame && chunk.byteLength >= 2) {
          this.listeners.onFrame({ samples: pcm16ToFloat(chunk), sampleRate: 16_000 });
        }
        const expectedMs = (bytesWritten * 1000) / FILE_BYTES_PER_SECOND;
        const sleepMs = expectedMs - (clock.nowMs() - startedAt - pauseAccumulatedMs);
        if (sleepMs > 0) await clock.sleep(Math.trunc(sleepMs), cancel);
      }
    } catch (error) {
      const failure = toError(error);
      this.pumpFailure = failure;
      if (!this.userStop) this.listeners.onFaulted?.(failure);
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
