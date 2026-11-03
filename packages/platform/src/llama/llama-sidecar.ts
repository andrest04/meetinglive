import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import nodePath from 'node:path';
import { CancelledError, type CancelSignal } from '@vozella/core';
import type { ProcessGuard, ProtectedProcess } from './process-guard';

export interface LlamaStartOptions {
  /** Full path of `llama-server.exe`. The working directory is its folder. */
  readonly exe: string;
  readonly modelPath: string;
  readonly contextTokens?: number;
  /** `'auto'` offloads every layer (`-ngl 999`); a number offloads that many; 0 is CPU only. */
  readonly gpuLayers?: 'auto' | number;
  readonly extraArgs?: readonly string[];
  /** Arguments placed before the llama flags. Tests use it to run a Node script as the server. */
  readonly argsPrefix?: readonly string[];
  readonly healthTimeoutMs?: number;
  readonly cancel?: CancelSignal;
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatOptions {
  readonly maxTokens?: number;
  readonly temperature?: number;
  /** Sampler values sent to the server as given. Left out, the server defaults apply. */
  readonly topP?: number;
  readonly topK?: number;
  readonly minP?: number;
  readonly repeatPenalty?: number;
  readonly seed?: number;
  /** False makes the server forget the prompt after the call (no slot reuse). */
  readonly cachePrompt?: boolean;
  readonly signal?: CancelSignal;
}

export interface TokenizeOptions {
  /** Count the BOS token the way a real prompt gets it. */
  readonly addSpecial?: boolean;
  /** Read special-token text such as chat markers as tokens, not as plain text. */
  readonly parseSpecial?: boolean;
}

/** One parsed SSE event. */
export interface ChatDelta {
  readonly content?: string;
  readonly finishReason?: string;
  readonly usage?: { readonly promptTokens: number; readonly completionTokens: number };
}

export type LlamaSidecarErrorCode =
  'exited-early' | 'health-timeout' | 'crashed' | 'http' | 'not-running' | 'spawn';

export class LlamaSidecarError extends Error {
  constructor(
    readonly code: LlamaSidecarErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlamaSidecarError';
  }
}

export interface LlamaSidecarOptions {
  readonly guard: ProcessGuard;
  /** The server stops after this long without a request. Default 10 minutes; 0 disables. */
  readonly idleTimeoutMs?: number;
  readonly healthPollMs?: number;
  /** Time between the polite kill and `taskkill /T /F`. */
  readonly killGraceMs?: number;
  /** Characters of server output kept for diagnostics. */
  readonly outputLimit?: number;
}

const DEFAULT_IDLE_MS = 10 * 60_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 120_000;
const AUTO_GPU_LAYERS = 999;

/** The last `limit` characters of what the server printed. */
export class OutputRing {
  private text = '';
  constructor(private readonly limit: number) {}

  append(chunk: string): void {
    this.text = (this.text + chunk).slice(-this.limit);
  }

  tail(chars: number): string {
    return this.text.slice(-chars);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Running {
  readonly proc: ChildProcess;
  readonly port: number;
  readonly apiKey: string;
  readonly exited: Promise<void>;
  protection: ProtectedProcess | undefined;
  /** Set when stop() or the idle timer ended it on purpose. */
  intentional: boolean;
  exitCode: number | null;
}

const live = new Set<LlamaSidecar>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Synchronous last resort; the Job Object or the watchdog covers a hard crash.
  process.on('exit', () => {
    for (const sidecar of live) sidecar.killNow();
  });
}

/**
 * One llama-server process: loopback port, per-launch API key, health wait, streaming chat,
 * tokenize, idle stop, one restart after a crash, and a kill that cannot leave an orphan.
 */
export class LlamaSidecar {
  private running: Running | undefined;
  private startOptions: LlamaStartOptions | undefined;
  private starting: Promise<Running> | undefined;
  private crashRestarts = 0;
  private stopped = true;
  private active = 0;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly output: OutputRing;

  constructor(private readonly options: LlamaSidecarOptions) {
    this.output = new OutputRing(options.outputLimit ?? 64_000);
  }

  get isRunning(): boolean {
    const current = this.running;
    return current !== undefined && !current.intentional && current.exitCode === null;
  }

  get pid(): number | undefined {
    return this.running?.proc.pid;
  }

  /** Recent server output with the API key removed. */
  diagnostics(chars = 2000): string {
    return this.scrub(this.output.tail(chars));
  }

  async start(options: LlamaStartOptions): Promise<void> {
    await this.stop();
    this.startOptions = options;
    this.stopped = false;
    this.crashRestarts = 0;
    await this.launch(options);
  }

  async *chatStream(
    messages: readonly ChatMessage[],
    options: ChatOptions = {},
  ): AsyncGenerator<ChatDelta> {
    const running = await this.acquire();
    const controller = new AbortController();
    const removeCancel = options.signal?.onCancel(() => controller.abort());
    try {
      const response = await this.request(
        running,
        '/v1/chat/completions',
        {
          messages,
          stream: true,
          max_tokens: options.maxTokens ?? 256,
          temperature: options.temperature ?? 0.2,
          ...(options.topP === undefined ? {} : { top_p: options.topP }),
          ...(options.topK === undefined ? {} : { top_k: options.topK }),
          ...(options.minP === undefined ? {} : { min_p: options.minP }),
          ...(options.repeatPenalty === undefined ? {} : { repeat_penalty: options.repeatPenalty }),
          ...(options.seed === undefined ? {} : { seed: options.seed }),
          ...(options.cachePrompt === undefined ? {} : { cache_prompt: options.cachePrompt }),
          stream_options: { include_usage: true },
        },
        controller.signal,
      );
      if (!response.body) throw new LlamaSidecarError('http', 'chat: empty body');
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(part, { stream: true });
        let end = buffer.indexOf('\n\n');
        while (end >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of event.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            const delta = parseDelta(data);
            if (delta) yield delta;
          }
          end = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (options.signal?.cancelled || controller.signal.aborted) throw new CancelledError();
      throw this.crashedOr(running, error);
    } finally {
      removeCancel?.();
      controller.abort();
      this.release();
    }
  }

  /** Token count of `text` for the loaded model. */
  async tokenize(
    text: string,
    signal?: CancelSignal,
    options: TokenizeOptions = {},
  ): Promise<number> {
    const running = await this.acquire();
    const controller = new AbortController();
    const removeCancel = signal?.onCancel(() => controller.abort());
    try {
      const response = await this.request(
        running,
        '/tokenize',
        {
          content: text,
          ...(options.addSpecial === undefined ? {} : { add_special: options.addSpecial }),
          ...(options.parseSpecial === undefined ? {} : { parse_special: options.parseSpecial }),
        },
        controller.signal,
      );
      const body = (await response.json()) as { tokens?: unknown[] };
      return Array.isArray(body.tokens) ? body.tokens.length : 0;
    } catch (error) {
      if (signal?.cancelled) throw new CancelledError();
      throw this.crashedOr(running, error);
    } finally {
      removeCancel?.();
      this.release();
    }
  }

  /** Kills the server, waits for it to exit, and falls back to `taskkill /T /F`. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.clearIdle();
    const pending = this.starting;
    if (pending) await pending.catch(() => undefined);
    const running = this.running;
    if (!running) return;
    await this.terminate(running);
    if (this.running === running) this.running = undefined;
  }

  /** Sync kill for the process `exit` hook and the before-quit path. */
  killNow(): void {
    const running = this.running;
    if (running?.exitCode !== null) return;
    running.intentional = true;
    try {
      running.proc.kill();
    } catch {
      // already gone
    }
  }

  private async acquire(): Promise<Running> {
    if (this.stopped) throw new LlamaSidecarError('not-running', 'llama-server is not running');
    this.clearIdle();
    this.active += 1;
    try {
      const current = this.running;
      if (current && !current.intentional && current.exitCode === null) return current;
      return await this.relaunch(current);
    } catch (error) {
      this.release();
      throw error;
    }
  }

  private release(): void {
    this.active -= 1;
    if (this.active === 0) this.armIdle();
  }

  /** After an idle stop the server starts again; a crash gets one restart before it surfaces. */
  private relaunch(previous: Running | undefined): Promise<Running> {
    if (this.starting) return this.starting;
    const options = this.startOptions;
    if (!options) return Promise.reject(new LlamaSidecarError('not-running', 'not running'));
    if (previous && !previous.intentional) {
      if (this.crashRestarts >= 1) {
        return Promise.reject(
          new LlamaSidecarError(
            'crashed',
            `llama-server exited (${previous.exitCode}):\n${this.diagnostics()}`,
          ),
        );
      }
      this.crashRestarts += 1;
    }
    return this.launch(options);
  }

  private launch(options: LlamaStartOptions): Promise<Running> {
    const starting = this.doLaunch(options).finally(() => {
      if (this.starting === starting) this.starting = undefined;
    });
    this.starting = starting;
    return starting;
  }

  private async doLaunch(options: LlamaStartOptions): Promise<Running> {
    const port = await freePort();
    const apiKey = randomBytes(24).toString('hex');
    const layers = options.gpuLayers ?? 'auto';
    const args = [
      ...(options.argsPrefix ?? []),
      '-m',
      options.modelPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--api-key',
      apiKey,
      '-c',
      String(options.contextTokens ?? 4096),
      '--no-webui',
      '-ngl',
      String(layers === 'auto' ? AUTO_GPU_LAYERS : layers),
      ...(options.extraArgs ?? []),
    ];
    const proc = spawn(options.exe, args, {
      cwd: nodePath.dirname(options.exe),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let spawnError: Error | undefined;
    let settle: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const running: Running = {
      proc,
      port,
      apiKey,
      exited,
      protection: undefined,
      intentional: false,
      exitCode: null,
    };
    proc.once('exit', (code) => {
      running.exitCode = code ?? -1;
      settle();
    });
    proc.once('error', (error) => {
      spawnError = error;
      running.exitCode ??= -1;
      settle();
    });
    const keep = (chunk: Buffer) => this.output.append(chunk.toString('utf8'));
    proc.stdout.on('data', keep);
    proc.stderr.on('data', keep);
    live.add(this);
    installExitHook();
    this.running = running;
    try {
      // Guard before anything else, so a crash during model load still cannot orphan it.
      if (proc.pid !== undefined) running.protection = this.options.guard.protect(proc.pid);
      await this.waitHealthy(running, options, () => spawnError);
    } catch (error) {
      await this.terminate(running);
      if (this.running === running) this.running = undefined;
      throw error;
    }
    return running;
  }

  private async waitHealthy(
    running: Running,
    options: LlamaStartOptions,
    spawnError: () => Error | undefined,
  ): Promise<void> {
    const timeout = options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    const poll = this.options.healthPollMs ?? 250;
    const started = Date.now();
    for (;;) {
      if (options.cancel?.cancelled) throw new CancelledError();
      const failed = spawnError();
      if (failed) {
        throw new LlamaSidecarError('spawn', `could not start llama-server: ${failed.message}`);
      }
      if (running.exitCode !== null) {
        throw new LlamaSidecarError(
          'exited-early',
          `llama-server exited early (${running.exitCode}):\n${this.diagnostics()}`,
        );
      }
      try {
        // /health skips the API key: 503 while the model loads, 200 when ready.
        const response = await fetch(`http://127.0.0.1:${running.port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (response.status === 200) return;
      } catch {
        // not listening yet
      }
      if (Date.now() - started > timeout) {
        throw new LlamaSidecarError(
          'health-timeout',
          `llama-server did not become ready in ${timeout} ms`,
        );
      }
      await delay(poll);
    }
  }

  /**
   * POST to the server. A connection failure while the process is found dead means it crashed
   * before the exit event arrived, so this takes the same one-restart path as an idle crash.
   */
  private async request(
    running: Running,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.post(running, path, body, signal);
    } catch (error) {
      if (error instanceof LlamaSidecarError || signal.aborted) throw error;
      await Promise.race([running.exited, delay(1000)]);
      if (running.exitCode === null || running.intentional) throw error;
      const next = await this.relaunch(running);
      return this.post(next, path, body, signal);
    }
  }

  private async post(
    running: Running,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(`http://127.0.0.1:${running.port}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${running.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const text = this.scrub((await response.text()).slice(0, 500));
      throw new LlamaSidecarError('http', `${path} ${response.status}: ${text}`);
    }
    return response;
  }

  private crashedOr(running: Running, error: unknown): Error {
    if (error instanceof LlamaSidecarError) return error;
    if (running.exitCode !== null && !running.intentional) {
      return new LlamaSidecarError(
        'crashed',
        `llama-server exited (${running.exitCode}):\n${this.diagnostics()}`,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private async terminate(running: Running): Promise<void> {
    running.intentional = true;
    if (running.exitCode === null) {
      const pid = running.proc.pid;
      try {
        running.proc.kill();
      } catch {
        // already gone
      }
      const grace = this.options.killGraceMs ?? 3000;
      const forced = await Promise.race([
        running.exited.then(() => false),
        delay(grace).then(() => true),
      ]);
      if (forced && pid !== undefined) await forceKillTree(pid);
      await Promise.race([running.exited, delay(5000)]);
    }
    running.protection?.release();
    live.delete(this);
  }

  private armIdle(): void {
    const idle = this.options.idleTimeoutMs ?? DEFAULT_IDLE_MS;
    if (idle <= 0 || this.stopped || !this.running) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => {
      const running = this.running;
      if (this.active > 0 || !running) return;
      void this.terminate(running).then(() => {
        if (this.running === running) this.running = undefined;
      });
    }, idle);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private scrub(text: string): string {
    const key = this.running?.apiKey;
    return key ? text.split(key).join('***') : text;
  }
}

function forceKillTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve(),
      );
      return;
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
    resolve();
  });
}

function parseDelta(data: string): ChatDelta | undefined {
  let json: {
    choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    json = JSON.parse(data) as typeof json;
  } catch {
    return undefined;
  }
  const choice = json.choices?.[0];
  const content = typeof choice?.delta?.content === 'string' ? choice.delta.content : undefined;
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
  const usage = json.usage
    ? {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
      }
    : undefined;
  if (content === undefined && finishReason === undefined && usage === undefined) return undefined;
  return { content, finishReason, usage };
}
