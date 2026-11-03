import { resolveUiLanguage, UI_LANGUAGE_TAGS } from '../i18n/ui-language';
import {
  resolveClaudeEffort,
  resolveClaudeModelId,
  resolveCodexEffort,
  resolveCodexModelId,
  resolveSummaryProviderKind,
  resolveXaiEffort,
  SUMMARY_PROVIDERS,
  type AppSettings,
  type SettingsStore,
} from '../library';
import {
  CLAUDE_EFFORTS,
  CODEX_EFFORTS,
  XAI_EFFORTS,
  CLAUDE_MODELS,
  CODEX_MODELS,
} from './inference-options';
import {
  normalizeLanguageCode,
  resolveMeetingLanguageCode,
  resolveSummaryLanguageCode,
  SUMMARY_LANGUAGES,
  TRANSCRIPTION_LANGUAGES,
} from './languages';

/** A line for the shared success bar. The UI turns `key` and `args` into text in its language. */
export interface Feedback {
  readonly key: 'Xai_FeedbackModel' | 'Xai_FeedbackApiKey' | 'Xai_FeedbackSignedOut';
  readonly args: readonly string[];
}

export type IgnoredReason = 'blank' | 'unchanged' | 'invalid';

/**
 * What a settings change did. Failures are values: the page shows them, nothing is thrown at an
 * event handler (B12).
 */
export type CommitOutcome =
  | { readonly status: 'saved'; readonly settings: AppSettings; readonly feedback: Feedback | null }
  | { readonly status: 'ignored'; readonly reason: IgnoredReason }
  | { readonly status: 'failed'; readonly message: string };

export const ignored = (reason: IgnoredReason): CommitOutcome => ({ status: 'ignored', reason });

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type CliOptionProvider = 'claude' | 'codex' | 'xai';
export type CliOptionField = 'model' | 'effort';

export interface SettingsCommandsDeps {
  readonly store: SettingsStore;
  /** The OS preferred languages, for what the app language picker shows when nothing is saved. */
  readonly osLanguages: () => readonly string[];
}

/** The `model · effort` text of the shared feedback bar, with a middle dot. */
const modelAndEffort = (model: string, effort: string): string => `${model} · ${effort}`;

/**
 * The single place the Settings page changes the fields it owns. Every change is a patch applied
 * under the store's lock, so sections cannot overwrite each other (B1). A change that is blank,
 * unchanged or not one of the offered choices is ignored, as the page ignores such events.
 */
export class SettingsCommands {
  constructor(private readonly deps: SettingsCommandsDeps) {}

  /** `en-US` or `es`, compared with what the picker shows now. */
  async setUiLanguage(tag: string): Promise<CommitOutcome> {
    return this.commit((current) => {
      if (!(UI_LANGUAGE_TAGS as readonly string[]).includes(tag)) return ignored('invalid');
      const shown = resolveUiLanguage(current.uiLanguage, this.deps.osLanguages());
      if (shown === tag) return ignored('unchanged');
      return { patch: { uiLanguage: tag } };
    });
  }

  /** The exact enum name only (B2). Selecting xAI makes the caller refresh the account. */
  async setSummaryProvider(kind: string): Promise<CommitOutcome> {
    return this.commit((current) => {
      if (!(SUMMARY_PROVIDERS as readonly string[]).includes(kind)) return ignored('invalid');
      if (resolveSummaryProviderKind(current) === kind) return ignored('unchanged');
      return { patch: { selectedSummaryProvider: kind } };
    });
  }

  async setCliOption(input: {
    readonly provider: CliOptionProvider;
    readonly field: CliOptionField;
    readonly value: string;
  }): Promise<CommitOutcome> {
    const { provider, field, value } = input;
    return this.commit((current) => {
      if (value.trim() === '') return ignored('blank');
      // The stored value counts as offered even when hand edited out of the list (B13).
      if (this.currentValue(current, provider, field) === value) return ignored('unchanged');
      const allowed = this.choices(provider, field);
      if (allowed !== null && !allowed.includes(value)) return ignored('invalid');
      if (allowed === null && value.length > 200) return ignored('invalid');
      return {
        patch: this.patchFor(provider, field, value),
        feedback: (next) => this.feedbackFor(next, provider),
      };
    });
  }

  /** `transcription` or `summary`, with the code of that picker's catalog. */
  async setMeetingLanguage(
    kind: 'transcription' | 'summary',
    code: string,
  ): Promise<CommitOutcome> {
    const catalog = kind === 'transcription' ? TRANSCRIPTION_LANGUAGES : SUMMARY_LANGUAGES;
    return this.commit((current) => {
      const wanted = normalizeLanguageCode(code);
      if (!catalog.some((entry) => entry.code === wanted)) return ignored('invalid');
      const shown =
        kind === 'transcription'
          ? resolveMeetingLanguageCode(current.transcriptionLanguage)
          : resolveSummaryLanguageCode(current.summaryLanguage);
      if (shown === wanted) return ignored('unchanged');
      return {
        patch:
          kind === 'transcription'
            ? { transcriptionLanguage: wanted }
            : { summaryLanguage: wanted },
      };
    });
  }

  private choices(provider: CliOptionProvider, field: CliOptionField): readonly string[] | null {
    if (provider === 'claude') return field === 'model' ? CLAUDE_MODELS : CLAUDE_EFFORTS;
    if (provider === 'codex') return field === 'model' ? CODEX_MODELS : CODEX_EFFORTS;
    // The xAI model list comes from the network, so any id is accepted.
    return field === 'model' ? null : XAI_EFFORTS;
  }

  private currentValue(
    s: AppSettings,
    provider: CliOptionProvider,
    field: CliOptionField,
  ): string | null {
    if (provider === 'claude') {
      return field === 'model' ? resolveClaudeModelId(s) : resolveClaudeEffort(s);
    }
    if (provider === 'codex') {
      return field === 'model' ? resolveCodexModelId(s) : resolveCodexEffort(s);
    }
    return field === 'model' ? s.selectedXaiModelId : resolveXaiEffort(s);
  }

  private patchFor(
    provider: CliOptionProvider,
    field: CliOptionField,
    value: string,
  ): Partial<AppSettings> {
    if (provider === 'claude') {
      return field === 'model' ? { selectedClaudeModelId: value } : { selectedClaudeEffort: value };
    }
    if (provider === 'codex') {
      return field === 'model' ? { selectedCodexModelId: value } : { selectedCodexEffort: value };
    }
    return field === 'model' ? { selectedXaiModelId: value } : { selectedXaiEffort: value };
  }

  private feedbackFor(next: AppSettings, provider: CliOptionProvider): Feedback | null {
    if (provider === 'claude') {
      return {
        key: 'Xai_FeedbackModel',
        args: [modelAndEffort(resolveClaudeModelId(next), resolveClaudeEffort(next))],
      };
    }
    if (provider === 'codex') {
      return {
        key: 'Xai_FeedbackModel',
        args: [modelAndEffort(resolveCodexModelId(next), resolveCodexEffort(next))],
      };
    }
    if (next.selectedXaiModelId === null) return null;
    return {
      key: 'Xai_FeedbackModel',
      args: [modelAndEffort(next.selectedXaiModelId, resolveXaiEffort(next))],
    };
  }

  /** Reads the fresh blob, lets `decide` accept or ignore, then applies the patch under the lock. */
  private async commit(
    decide: (
      current: AppSettings,
    ) =>
      | CommitOutcome
      | { patch: Partial<AppSettings>; feedback?: (next: AppSettings) => Feedback | null }
      | Promise<
          | CommitOutcome
          | { patch: Partial<AppSettings>; feedback?: (next: AppSettings) => Feedback | null }
        >,
  ): Promise<CommitOutcome> {
    try {
      const current = await this.deps.store.load();
      const decision = await decide(current);
      if ('status' in decision) return decision;
      const settings = await this.deps.store.update(decision.patch);
      return { status: 'saved', settings, feedback: decision.feedback?.(settings) ?? null };
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
  }
}
