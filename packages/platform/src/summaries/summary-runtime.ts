import {
  SummaryProviderFactory,
  SummaryProviderResolver,
  usesGpuOffload,
  type CancelSignal,
  type CliPathProbe,
  type CliProcessRunner,
  type HardwareProbe,
  type LocalModelStore,
  type SettingsStore,
  type SummaryProvider,
  type SummaryProviderKind,
} from '@vozella/core';
import { selectWorkingBackend } from '../llama/backend-choice';
import { LlamaRuntimeManager } from '../llama/llama-runtime-manager';
import { LlamaSidecar } from '../llama/llama-sidecar';
import { LocalLlmHost, type LocalLlmRuntime, type LocalLlmServer } from '../llama/local-llm-host';
import { LocalLlmSummaryProvider } from '../llama/local-llm-provider';
import { createProcessGuard, type ProcessJobPort } from '../llama/process-guard';
import { PathCliProbe } from '../settings/path-cli-probe';
import { NodeCliProcessRunner } from './cli-process-runner';

export interface SummaryRuntimeDeps {
  /** The single settings reader and writer (B2, B19). */
  readonly settings: SettingsStore;
  readonly hardware: HardwareProbe;
  /** The GGUF folder: `FileLocalModelStore` in production. */
  readonly models: LocalModelStore & { pathFor(fileName: string): string };
  /** `LlamaRuntime` folder under the app data root. */
  readonly llamaRoot: string;
  /** `nativePorts.processJob`: the kill-on-close job that leaves no llama-server behind. */
  readonly processJob?: ProcessJobPort;
  readonly runner?: CliProcessRunner;
  readonly cli?: CliPathProbe;
  /** The fake native build: a double for every engine. Null falls through to the real one. */
  readonly providerOverride?: (kind: SummaryProviderKind) => SummaryProvider | null;
  /** Replacements for tests. */
  readonly createServer?: () => LocalLlmServer;
  readonly resolveRuntime?: (cancel: CancelSignal) => Promise<LocalLlmRuntime>;
}

/**
 * The summary providers wired to their adapters: one `LocalLlmHost` (so every Local provider
 * shares the one loaded server, B3), the CLI runner, and the resolver/factory that read settings
 * only through `SettingsStore.load()` (B2). The composition root creates one.
 */
export class SummaryRuntime {
  readonly host: LocalLlmHost;
  readonly runner: CliProcessRunner;
  readonly factory: SummaryProviderFactory;
  readonly resolver: SummaryProviderResolver;
  readonly runtimeManager: LlamaRuntimeManager;
  private backend: Promise<LocalLlmRuntime> | undefined;

  constructor(private readonly deps: SummaryRuntimeDeps) {
    const cli = deps.cli ?? new PathCliProbe();
    this.runner = deps.runner ?? new NodeCliProcessRunner();
    this.runtimeManager = new LlamaRuntimeManager({ root: deps.llamaRoot });
    const guard = createProcessGuard(deps.processJob);
    this.host = new LocalLlmHost({
      createServer: deps.createServer ?? (() => new LlamaSidecar({ guard })),
      resolveRuntime: deps.resolveRuntime ?? ((cancel) => this.pickRuntime(cancel)),
    });
    this.factory = new SummaryProviderFactory({
      settings: deps.settings,
      runner: this.runner,
      ...(deps.providerOverride ? { override: deps.providerOverride } : {}),
      createLocal: (modelPath) =>
        new LocalLlmSummaryProvider({ host: this.host, modelPath: () => modelPath }),
    });
    this.resolver = new SummaryProviderResolver({
      settings: deps.settings,
      cli,
      models: deps.models,
      factory: this.factory,
    });
  }

  /** Quit: no llama-server may outlive the app. */
  async dispose(): Promise<void> {
    this.host.killNow();
    await this.host.dispose();
  }

  /** The working backend, chosen once; a failure is not cached so the next call retries. */
  private pickRuntime(cancel: CancelSignal): Promise<LocalLlmRuntime> {
    this.backend ??= (async () => {
      const hardware = await this.deps.hardware.detect();
      const picked = await selectWorkingBackend({
        hardware,
        manager: this.runtimeManager,
        cancel,
      });
      const runtime = { exe: picked.exe, gpuOffload: usesGpuOffload(picked.backend) };
      // A failed GPU read made the profile a guess: use it now, but pick again next time (B17).
      if (hardware.gpuReadComplete === false) this.backend = undefined;
      return runtime;
    })().catch((error: unknown) => {
      this.backend = undefined;
      throw error;
    });
    return this.backend;
  }
}
