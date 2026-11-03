import { resolveUiLanguage, type UiLanguageTag } from '../i18n/ui-language';
import {
  resolveClaudeEffort,
  resolveClaudeModelId,
  resolveCodexEffort,
  resolveCodexModelId,
  resolveSummaryProviderKind,
  resolveXaiEffort,
  type AppSettings,
  type SettingsStore,
  type SummaryProviderKind,
} from '../library';
import { cliExecutableName, isCliProvider } from './cli-providers';
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  CODEX_EFFORTS,
  CODEX_MODELS,
  optionsIncluding,
  XAI_EFFORTS,
} from './inference-options';
import { resolveMeetingLanguageCode, resolveSummaryLanguageCode } from './languages';
import type { LocalModelsService, ModelRows } from './local-models';
import type { PendingNotice, SettingsNotices } from './notices';
import type { CliPathProbe, HardwareProbe, SettingsCapabilities } from './ports';
import type { HardwareProfile } from './summary-models';
import type { XaiAccountService, XaiAccountView } from './xai-account';

export type CliStatus = 'detected' | 'missing';

export interface ProviderOptions {
  readonly model: string;
  readonly effort: string;
  /** The list, plus the stored value when it is not on it (B13). */
  readonly modelOptions: readonly string[];
  readonly effortOptions: readonly string[];
}

/** Everything the Settings page needs from the local phase of its load. Nothing here touches the network. */
export interface SettingsPageSnapshot {
  readonly settings: AppSettings;
  readonly uiLanguage: UiLanguageTag;
  readonly provider: SummaryProviderKind;
  readonly claude: ProviderOptions;
  readonly codex: ProviderOptions;
  readonly xaiEffort: string;
  readonly xaiEffortOptions: readonly string[];
  /** For the selected CLI provider only; null for Local and xAI. */
  readonly cliStatus: CliStatus | null;
  readonly transcriptionLanguage: string;
  readonly summaryLanguage: string;
  /** Null when the machine could not be read. */
  readonly hardware: HardwareProfile | null;
  readonly models: ModelRows;
  readonly xai: XaiAccountView;
  readonly capabilities: SettingsCapabilities;
  readonly notices: readonly PendingNotice[];
}

export interface SettingsPageDeps {
  readonly store: SettingsStore;
  readonly osLanguages: () => readonly string[];
  readonly hardware: HardwareProbe;
  readonly models: LocalModelsService;
  readonly xai: XaiAccountService;
  readonly cli: CliPathProbe;
  readonly notices: SettingsNotices;
  readonly capabilities: SettingsCapabilities;
}

/** Builds the page. Reads, never writes: opening Settings changes no setting. */
export class SettingsPageService {
  constructor(private readonly deps: SettingsPageDeps) {}

  /**
   * The local phase. Settings and the hardware are read together. A settings file that cannot be
   * read rejects, so the page can say so (B18); a machine that cannot be read is only a missing
   * fit rating.
   */
  async load(): Promise<SettingsPageSnapshot> {
    const [settings, hardware] = await Promise.all([
      this.deps.store.load(),
      this.deps.hardware.detect().catch(() => null),
    ]);
    const provider = resolveSummaryProviderKind(settings);
    const [models, xai, cliStatus] = await Promise.all([
      this.deps.models.rows(hardware),
      this.deps.xai.status(),
      this.detectCli(provider),
    ]);
    const claudeModel = resolveClaudeModelId(settings);
    const claudeEffort = resolveClaudeEffort(settings);
    const codexModel = resolveCodexModelId(settings);
    const codexEffort = resolveCodexEffort(settings);
    return {
      settings,
      uiLanguage: resolveUiLanguage(settings.uiLanguage, this.deps.osLanguages()),
      provider,
      claude: {
        model: claudeModel,
        effort: claudeEffort,
        modelOptions: optionsIncluding(CLAUDE_MODELS, claudeModel),
        effortOptions: optionsIncluding(CLAUDE_EFFORTS, claudeEffort),
      },
      codex: {
        model: codexModel,
        effort: codexEffort,
        modelOptions: optionsIncluding(CODEX_MODELS, codexModel),
        effortOptions: optionsIncluding(CODEX_EFFORTS, codexEffort),
      },
      xaiEffort: resolveXaiEffort(settings),
      xaiEffortOptions: optionsIncluding(XAI_EFFORTS, resolveXaiEffort(settings)),
      cliStatus,
      transcriptionLanguage: resolveMeetingLanguageCode(settings.transcriptionLanguage),
      summaryLanguage: resolveSummaryLanguageCode(settings.summaryLanguage),
      hardware,
      models,
      xai,
      capabilities: this.deps.capabilities,
      notices: this.deps.notices.pending(),
    };
  }

  /** Looks for the program again, so installing it while Settings is open is noticed (B15). */
  async detectCli(kind: SummaryProviderKind): Promise<CliStatus | null> {
    if (!isCliProvider(kind)) return null;
    const found = await this.deps.cli.isOnPath(cliExecutableName(kind));
    return found ? 'detected' : 'missing';
  }
}
