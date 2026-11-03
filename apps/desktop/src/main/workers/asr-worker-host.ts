import {
  asrResultsSchema,
  asrWorkerEventSchema,
  type AsrRpcCall,
  type AsrWorkerCommand,
} from '@vozella/contracts';
import type {
  AsrEngine,
  AsrRecognizer,
  AsrResult,
  AsrStream,
  Logger,
  RecognizerSettings,
  StreamOptions,
} from '@vozella/core';
import { ManagedWorker, type WorkerProcess } from './managed-worker';

export interface AsrWorkerHostOptions {
  readonly spawn: () => WorkerProcess;
  readonly logger: Logger;
  /** Calls other than creating a recognizer. Default 120 s. */
  readonly requestTimeoutMs?: number;
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Main-process handle on the ASR worker, and the {@link AsrEngine} core talks to. The process
 * starts on the first call. When it dies, every call in flight fails and every recognizer and
 * stream made before is gone; the proxies say so instead of talking to the new process.
 */
export class AsrWorkerHost implements AsrEngine {
  private readonly worker: ManagedWorker;
  private nextId = 1;
  private nextHandle = 1;
  private generation = 0;
  private readonly pending = new Map<number, Pending>();
  private pendingPong: ((koffi: string | null) => void) | undefined;
  private pendingLoad: Pending | undefined;

  constructor(private readonly options: AsrWorkerHostOptions) {
    this.worker = new ManagedWorker({
      name: 'asr',
      logger: options.logger,
      spawn: options.spawn,
      onMessage: (raw) => {
        this.handleMessage(raw);
      },
      onStateChange: (state) => {
        if (state === 'restarting' || state === 'failed' || state === 'stopped') this.failAll();
      },
    });
  }

  get state(): string {
    return this.worker.state;
  }

  /** Proves the process is up and koffi loads. A broken koffi answers null. */
  ping(): Promise<string | null> {
    this.ensureStarted();
    return new Promise((resolve) => {
      this.pendingPong = resolve;
      this.command({ type: 'ping' });
    });
  }

  /** Loads the engine library from a folder and answers its version (diagnostics). */
  loadLibrary(binDir: string): Promise<string> {
    this.ensureStarted();
    return new Promise<string>((resolve, reject) => {
      this.pendingLoad = {
        resolve: (value) => {
          resolve(String(value));
        },
        reject,
        timer: undefined,
      };
      this.command({ type: 'load', binDir });
    });
  }

  async createRecognizer(settings: RecognizerSettings): Promise<AsrRecognizer> {
    const recognizerId = `r${String(this.nextHandle++)}`;
    await this.call({ method: 'createRecognizer', recognizerId, settings }, 0);
    return new RecognizerProxy(this, recognizerId, this.generation);
  }

  /** @internal Used by the proxies. */
  async rpc<T = unknown>(call: AsrRpcCall, generation: number): Promise<T> {
    if (generation !== this.generation) {
      throw new Error('The speech engine restarted, so this session is over.');
    }
    return (await this.call(call, this.options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS)) as T;
  }

  /** @internal False once the process behind a handle has been replaced. */
  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  /** @internal */
  newStreamId(): string {
    return `s${String(this.nextHandle++)}`;
  }

  async dispose(): Promise<void> {
    await this.worker.stop();
  }

  private call(call: AsrRpcCall, timeoutMs: number): Promise<unknown> {
    this.ensureStarted();
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`The speech engine did not answer ${call.method} in time.`));
            }, timeoutMs)
          : undefined;
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
      try {
        this.command({ type: 'rpc', id, call });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureStarted(): void {
    if (this.worker.state === 'idle' || this.worker.state === 'stopped') this.worker.start();
  }

  private command(command: AsrWorkerCommand): void {
    this.worker.send(command);
  }

  private handleMessage(raw: unknown): void {
    const parsed = asrWorkerEventSchema.safeParse(raw);
    if (!parsed.success) {
      this.options.logger.warn('asr worker sent an invalid message');
      return;
    }
    const event = parsed.data;
    switch (event.type) {
      case 'pong':
        this.pendingPong?.(event.koffi);
        this.pendingPong = undefined;
        return;
      case 'loaded':
        this.pendingLoad?.resolve(event.version);
        this.pendingLoad = undefined;
        return;
      case 'error':
        if (this.pendingLoad) {
          this.pendingLoad.reject(new Error(event.message));
          this.pendingLoad = undefined;
        } else {
          this.options.logger.error('asr worker error', { message: event.message });
        }
        return;
      case 'rpc-result': {
        const entry = this.pending.get(event.id);
        if (!entry) return;
        this.pending.delete(event.id);
        if (event.ok) entry.resolve(event.result);
        else entry.reject(new Error(event.message ?? 'The speech engine call failed.'));
        return;
      }
    }
  }

  /** The process is gone: nothing in flight will be answered and old handles are void. */
  private failAll(): void {
    this.generation += 1;
    const error = new Error('The speech engine stopped unexpectedly.');
    for (const [id, entry] of [...this.pending]) {
      this.pending.delete(id);
      entry.reject(error);
    }
    this.pendingLoad?.reject(error);
    this.pendingLoad = undefined;
    this.pendingPong?.(null);
    this.pendingPong = undefined;
  }
}

class RecognizerProxy implements AsrRecognizer {
  private disposed = false;

  constructor(
    private readonly host: AsrWorkerHost,
    private readonly id: string,
    private readonly generation: number,
  ) {}

  async startStream(options: StreamOptions): Promise<AsrStream> {
    const streamId = this.host.newStreamId();
    await this.host.rpc(
      { method: 'startStream', streamId, recognizerId: this.id, options },
      this.generation,
    );
    return new StreamProxy(this.host, streamId, this.generation);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.host.isCurrent(this.generation)) return;
    await this.host.rpc({ method: 'disposeRecognizer', recognizerId: this.id }, this.generation);
  }
}

class StreamProxy implements AsrStream {
  private disposed = false;

  constructor(
    private readonly host: AsrWorkerHost,
    private readonly id: string,
    private readonly generation: number,
  ) {}

  async push(samples: Float32Array, sampleRate: number): Promise<void> {
    await this.host.rpc(
      { method: 'push', streamId: this.id, samples, sampleRate },
      this.generation,
    );
  }

  async pullAvailable(): Promise<readonly AsrResult[]> {
    const raw = await this.host.rpc({ method: 'pull', streamId: this.id }, this.generation);
    return asrResultsSchema.parse(raw);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (!this.host.isCurrent(this.generation)) return;
    await this.host.rpc({ method: 'disposeStream', streamId: this.id }, this.generation);
  }
}
