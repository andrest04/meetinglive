import { CONTEXT_TOKENS, type CancelSignal } from '@vozella/core';
import type {
  ChatDelta,
  ChatMessage,
  ChatOptions,
  LlamaStartOptions,
  TokenizeOptions,
} from './llama-sidecar';

/** The part of `LlamaSidecar` the local provider uses, so tests can substitute a double. */
export interface LocalLlmServer {
  start(options: LlamaStartOptions): Promise<void>;
  stop(): Promise<void>;
  killNow(): void;
  chatStream(messages: readonly ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatDelta>;
  tokenize(text: string, signal?: CancelSignal, options?: TokenizeOptions): Promise<number>;
}

/** Which llama-server build to run and whether it offloads layers to the GPU. */
export interface LocalLlmRuntime {
  readonly exe: string;
  readonly gpuOffload: boolean;
  readonly argsPrefix?: readonly string[];
  readonly extraArgs?: readonly string[];
  readonly healthTimeoutMs?: number;
}

export interface LocalLlmHostOptions {
  createServer(): LocalLlmServer;
  resolveRuntime(cancel: CancelSignal): Promise<LocalLlmRuntime>;
  readonly contextTokens?: number;
}

interface Loaded {
  readonly modelPath: string;
  readonly server: LocalLlmServer;
}

/**
 * B3: one running llama-server per model path. The first call loads it, concurrent calls wait
 * for that load, later calls reuse it. Choosing another model stops the old server first.
 * `dispose` (provider disposal, app exit) stops it; calling it with nothing loaded is a no-op.
 * Idle shutdown belongs to the sidecar, which restarts itself on the next request.
 */
export class LocalLlmHost {
  private loaded: Loaded | undefined;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: LocalLlmHostOptions) {}

  get loadedModelPath(): string | undefined {
    return this.loaded?.modelPath;
  }

  acquire(modelPath: string, cancel: CancelSignal): Promise<LocalLlmServer> {
    return this.serialized(async () => {
      const current = this.loaded;
      if (current?.modelPath === modelPath) return current.server;
      if (current) await this.stopLoaded(current);
      const runtime = await this.options.resolveRuntime(cancel);
      const server = this.options.createServer();
      const next: Loaded = { modelPath, server };
      this.loaded = next;
      try {
        await server.start({
          exe: runtime.exe,
          modelPath,
          contextTokens: this.options.contextTokens ?? CONTEXT_TOKENS,
          gpuLayers: runtime.gpuOffload ? 'auto' : 0,
          // One slot: the whole context belongs to the one request in flight.
          extraArgs: ['-np', '1', ...(runtime.extraArgs ?? [])],
          argsPrefix: runtime.argsPrefix,
          healthTimeoutMs: runtime.healthTimeoutMs,
          cancel,
        });
      } catch (error) {
        await this.stopLoaded(next);
        throw error;
      }
      return server;
    });
  }

  /** Forgets and stops a server that crashed for good, so the next call starts a fresh one. */
  invalidate(server: LocalLlmServer): Promise<void> {
    return this.serialized(async () => {
      if (this.loaded?.server === server) await this.stopLoaded(this.loaded);
    });
  }

  dispose(): Promise<void> {
    return this.serialized(async () => {
      if (this.loaded) await this.stopLoaded(this.loaded);
    });
  }

  /** Synchronous last resort for the app exit hook. */
  killNow(): void {
    this.loaded?.server.killNow();
  }

  private async stopLoaded(loaded: Loaded): Promise<void> {
    if (this.loaded === loaded) this.loaded = undefined;
    await loaded.server.stop();
  }

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
