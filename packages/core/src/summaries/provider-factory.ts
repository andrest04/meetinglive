import type { SettingsStore } from '../library/ports';
import {
  isProviderAvailable,
  resolveClaudeEffort,
  resolveClaudeModelId,
  resolveCodexEffort,
  resolveCodexModelId,
  type SummaryProviderKind,
} from '../library/settings';
import {
  createClaudeCodeProvider,
  createClaudeCodeWebSearchProvider,
} from './claude-code-provider';
import type { CliProcessRunner } from './cli-failure';
import { createCodexProvider, createCodexWebSearchProvider } from './codex-provider';
import type { SummaryProvider } from './provider';

export interface SummaryProviderFactoryDeps {
  /** The single settings reader (B2): every provider is built from `settings.load()`. */
  readonly settings: SettingsStore;
  readonly runner: CliProcessRunner;
  /** Builds the local provider for a model file. The platform shares one host behind it (B3). */
  readonly createLocal: (modelPath: string) => SummaryProvider;
  /** The fake native build answers every kind with a double. Null falls through to the real one. */
  readonly override?: (kind: SummaryProviderKind) => SummaryProvider | null;
}

export interface CreateProviderOptions {
  /** Required for Local. */
  readonly modelPath?: string | null;
  /** The live-answer path only (item 143). Summaries never ask for it. */
  readonly webSearch?: boolean;
}

/**
 * `AppServices.CreateSummaryProvider`. A new provider on every call, with model and effort read
 * from the current settings, so a change in Settings is seen by the next call. Local is the one
 * provider that is cheap to rebuild because the heavy server lives in the shared host.
 */
export class SummaryProviderFactory {
  constructor(private readonly deps: SummaryProviderFactoryDeps) {}

  async create(
    kind: SummaryProviderKind,
    options: CreateProviderOptions = {},
  ): Promise<SummaryProvider> {
    if (!isProviderAvailable(kind)) {
      throw new RangeError(`The ${kind} provider was removed.`);
    }
    const overridden = this.deps.override?.(kind) ?? null;
    if (overridden !== null) return overridden;
    if (kind === 'Local') {
      if (options.modelPath === undefined || options.modelPath === null) {
        throw new TypeError('A model path is required for the local provider.');
      }
      return this.deps.createLocal(options.modelPath);
    }
    const settings = await this.deps.settings.load();
    const webSearch = options.webSearch === true;
    if (kind === 'ClaudeCode') {
      const make = webSearch ? createClaudeCodeWebSearchProvider : createClaudeCodeProvider;
      return make(this.deps.runner, {
        model: resolveClaudeModelId(settings),
        effort: resolveClaudeEffort(settings),
      });
    }
    const make = webSearch ? createCodexWebSearchProvider : createCodexProvider;
    return make(this.deps.runner, {
      model: resolveCodexModelId(settings),
      effort: resolveCodexEffort(settings),
    });
  }
}
