import { audioWorkerEventSchema, type AudioWorkerCommand } from '@vozella/contracts';
import type { AudioFrame, AudioSource, CaptureStats, Logger } from '@vozella/core';
import { ManagedWorker, type WorkerProcess, type WorkerState } from './managed-worker';

export interface AudioWorkerHostOptions {
  readonly spawn: () => WorkerProcess;
  readonly logger: Logger;
  readonly requestTimeoutMs?: number;
  readonly onStateChange?: (state: WorkerState) => void;
}

export interface PongInfo {
  readonly backend: 'native' | 'fake';
  readonly platformSupported: boolean;
}

export interface CaptureListener {
  onFrame(frame: AudioFrame): void;
  onError?(message: string): void;
}

interface Pending<T> {
  resolve(value: T): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Main-process handle on the audio worker. Starts the process lazily, validates every
 * message in both directions, and resumes an active capture after a crash restart.
 */
export class AudioWorkerHost {
  private readonly worker: ManagedWorker;
  private pendingPong: Pending<PongInfo> | undefined;
  private pendingStop: Pending<CaptureStats> | undefined;
  private pendingStart: Pending<undefined> | undefined;
  private active: { source: AudioSource; listener: CaptureListener } | undefined;

  constructor(private readonly options: AudioWorkerHostOptions) {
    this.worker = new ManagedWorker({
      name: 'audio',
      logger: options.logger,
      spawn: options.spawn,
      onMessage: (raw) => {
        this.handleMessage(raw);
      },
      onRestarted: () => {
        this.resume();
      },
      ...(options.onStateChange ? { onStateChange: options.onStateChange } : {}),
    });
  }

  get state(): WorkerState {
    return this.worker.state;
  }

  /** Round trip that proves the worker is up and reports which backend it loaded. */
  ping(): Promise<PongInfo> {
    this.ensureStarted();
    return new Promise<PongInfo>((resolve, reject) => {
      this.pendingPong = this.pending(resolve, reject, 'ping');
      this.command({ type: 'ping' });
    });
  }

  async startCapture(source: AudioSource, listener: CaptureListener): Promise<void> {
    if (this.active) throw new Error('a capture is already running');
    this.ensureStarted();
    this.active = { source, listener };
    try {
      await new Promise<undefined>((resolve, reject) => {
        this.pendingStart = this.pending(resolve, reject, 'start');
        this.command({ type: 'start', source: toWireSource(source) });
      });
    } catch (error) {
      this.active = undefined;
      throw error;
    }
  }

  async stopCapture(): Promise<CaptureStats | undefined> {
    if (!this.active) return undefined;
    this.active = undefined;
    return new Promise<CaptureStats>((resolve, reject) => {
      this.pendingStop = this.pending(resolve, reject, 'stop');
      this.command({ type: 'stop' });
    });
  }

  async dispose(): Promise<void> {
    this.active = undefined;
    await this.worker.stop();
  }

  private ensureStarted(): void {
    if (this.worker.state === 'failed') {
      throw new Error('the audio worker crashed too many times');
    }
    this.worker.start();
  }

  private command(command: AudioWorkerCommand): void {
    this.worker.send(command);
  }

  private resume(): void {
    if (!this.active) return;
    this.options.logger.warn('resuming capture after audio worker restart');
    const { source } = this.active;
    this.command({ type: 'start', source: toWireSource(source) });
  }

  private handleMessage(raw: unknown): void {
    const parsed = audioWorkerEventSchema.safeParse(raw);
    if (!parsed.success) {
      this.options.logger.warn('audio worker sent an invalid message', {
        issues: parsed.error.issues.length,
      });
      return;
    }
    const event = parsed.data;
    switch (event.type) {
      case 'pong':
        settle(this.pendingPong, {
          backend: event.backend,
          platformSupported: event.platformSupported,
        });
        this.pendingPong = undefined;
        break;
      case 'started':
        settle(this.pendingStart, undefined);
        this.pendingStart = undefined;
        break;
      case 'frame':
        this.active?.listener.onFrame({
          pcm: event.pcm,
          tsMs: event.tsMs,
          synthesized: event.synthesized,
        });
        break;
      case 'stopped':
        settle(this.pendingStop, event.stats);
        this.pendingStop = undefined;
        break;
      case 'error':
        this.options.logger.error('audio worker error', { message: event.message });
        this.failOutstanding(event.message);
        break;
    }
  }

  /** Rejects the request the worker was answering, or tells the capture listener. */
  private failOutstanding(message: string): void {
    if (this.pendingStart) {
      this.pendingStart.reject(new Error(message));
      this.pendingStart = undefined;
    } else if (this.pendingPong) {
      this.pendingPong.reject(new Error(message));
      this.pendingPong = undefined;
    } else if (this.pendingStop) {
      this.pendingStop.reject(new Error(message));
      this.pendingStop = undefined;
    } else {
      this.active?.listener.onError?.(message);
    }
  }

  private pending<T>(
    resolve: (value: T) => void,
    reject: (error: Error) => void,
    what: string,
  ): Pending<T> {
    const timer = setTimeout(() => {
      reject(new Error(`audio worker did not answer ${what} in time`));
    }, this.options.requestTimeoutMs ?? 5000);
    return {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      timer,
    };
  }
}

function settle<T>(pending: Pending<T> | undefined, value: T): void {
  pending?.resolve(value);
}

function toWireSource(
  source: AudioSource,
): Extract<AudioWorkerCommand, { type: 'start' }>['source'] {
  return source.kind === 'process'
    ? { kind: 'process', pid: source.pid, includeTree: source.includeTree }
    : { kind: source.kind };
}
