import { resolveXaiEffort, type SettingsStore } from '../library';
import { messageOf, type Feedback } from './commands';
import type { XaiAccountPort, XaiCredentialKind } from './ports';
import { mergeModelList, resolveXaiModelId } from './xai';

export type XaiTitle = 'signed-out' | 'super-grok' | 'api-key' | 'error';

/** The line under the title. The UI chooses the words (`Xai_*` keys) in the user's language. */
export type XaiDetail =
  | { readonly kind: 'none' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'loading-models' }
  | { readonly kind: 'ready'; readonly model: string; readonly effort: string }
  /** `message` is the raw error text, shown after a localized lead-in. */
  | { readonly kind: 'error'; readonly message: string };

export interface XaiAccountView {
  /** False until an `XaiAccountPort` is registered; then the page offers no account controls. */
  readonly available: boolean;
  readonly signedIn: boolean;
  readonly credentialKind: XaiCredentialKind | null;
  readonly title: XaiTitle;
  readonly detail: XaiDetail;
  readonly models: readonly string[];
  readonly modelsLoaded: boolean;
  /** The saved id as stored (null when none yet). */
  readonly selectedModelId: string | null;
  readonly effort: string;
  /** True after a failed refresh: the credentials are still there, so the page offers a retry. */
  readonly canRetry: boolean;
}

export type XaiActionOutcome =
  | {
      readonly status: 'saved' | 'signed-out';
      readonly feedback: Feedback;
      readonly view: XaiAccountView;
    }
  | { readonly status: 'ignored' }
  | { readonly status: 'failed'; readonly message: string };

export interface XaiAccountDeps {
  readonly port: XaiAccountPort | null;
  readonly store: SettingsStore;
}

const UNAVAILABLE: XaiAccountView = {
  available: false,
  signedIn: false,
  credentialKind: null,
  title: 'signed-out',
  detail: { kind: 'none' },
  models: [],
  modelsLoaded: false,
  selectedModelId: null,
  effort: 'low',
  canRetry: false,
};

/**
 * The Grok account section: what is shown from the local store, and the refresh that asks the
 * network for models. Spec 2.5. Credentials and HTTP are behind `XaiAccountPort`.
 */
export class XaiAccountService {
  private models: string[] = [];
  private modelsLoaded = false;
  private error: string | null = null;
  private inflight: Promise<XaiAccountView> | null = null;
  /** Bumped whenever the credentials change, so a run that started before cannot publish. */
  private generation = 0;
  private inflightGeneration = -1;

  constructor(private readonly deps: XaiAccountDeps) {}

  /** From the local store only. No network. */
  async status(): Promise<XaiAccountView> {
    const port = this.deps.port;
    if (!port) return UNAVAILABLE;
    const kind = await port.credentialKind();
    if (kind === null) this.forget();
    const settings = await this.deps.store.load();
    const saved = settings.selectedXaiModelId;
    if (kind !== null && this.models.length === 0 && saved !== null && saved.trim() !== '') {
      this.models = [saved];
    }
    return this.view(kind, settings.selectedXaiModelId, resolveXaiEffort(settings));
  }

  /** Fetches the models for the current credentials. Concurrent calls share one run. */
  refresh(): Promise<XaiAccountView> {
    if (this.inflight && this.inflightGeneration === this.generation) return this.inflight;
    const generation = this.generation;
    const run: Promise<XaiAccountView> = this.runRefresh(generation).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    this.inflight = run;
    this.inflightGeneration = generation;
    return run;
  }

  async saveApiKey(key: string): Promise<XaiActionOutcome> {
    const port = this.deps.port;
    const trimmed = key.trim();
    if (!port || trimmed === '') return { status: 'ignored' };
    try {
      await port.saveApiKey(trimmed);
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
    this.forget();
    const view = await this.refresh();
    return { status: 'saved', feedback: { key: 'Xai_FeedbackApiKey', args: [] }, view };
  }

  async signOut(): Promise<XaiActionOutcome> {
    const port = this.deps.port;
    if (!port) return { status: 'ignored' };
    try {
      await port.signOut();
    } catch (error) {
      return { status: 'failed', message: messageOf(error) };
    }
    this.forget();
    const view = await this.refresh();
    return { status: 'signed-out', feedback: { key: 'Xai_FeedbackSignedOut', args: [] }, view };
  }

  private forget(): void {
    this.generation += 1;
    this.models = [];
    this.modelsLoaded = false;
    this.error = null;
  }

  private async runRefresh(generation: number): Promise<XaiAccountView> {
    const port = this.deps.port;
    if (!port) return UNAVAILABLE;
    try {
      const kind = await port.credentialKind();
      if (kind === null) {
        this.forget();
        const settings = await this.deps.store.load();
        return this.view(null, settings.selectedXaiModelId, resolveXaiEffort(settings));
      }
      const token = await port.getAccessToken();
      const listed = await port.listModels(token);
      const settings = await this.deps.store.load();
      const resolved = resolveXaiModelId(settings.selectedXaiModelId, listed);
      const current = generation === this.generation;
      if (current) this.models = mergeModelList(this.models, listed, resolved);
      let saved = settings;
      // Self healing: a model that vanished, or was never chosen, is replaced and kept.
      // A refresh that lost to a newer one must not write: its list is the old account's.
      if (current && settings.selectedXaiModelId !== resolved) {
        saved = await this.deps.store.update({ selectedXaiModelId: resolved });
      }
      if (current) {
        this.modelsLoaded = true;
        this.error = null;
      }
      return this.view(kind, saved.selectedXaiModelId, resolveXaiEffort(saved));
    } catch (error) {
      if (generation === this.generation) {
        this.modelsLoaded = false;
        this.error = messageOf(error);
      }
      const kind = await port.credentialKind().catch(() => null);
      const settings = await this.deps.store.load().catch(() => null);
      return this.view(
        kind,
        settings?.selectedXaiModelId ?? null,
        settings ? resolveXaiEffort(settings) : 'low',
      );
    }
  }

  private view(
    kind: XaiCredentialKind | null,
    selectedModelId: string | null,
    effort: string,
  ): XaiAccountView {
    const base = {
      available: true,
      credentialKind: kind,
      models: [...this.models],
      modelsLoaded: this.modelsLoaded,
      selectedModelId,
      effort,
    };
    if (kind === null) {
      return {
        ...base,
        signedIn: false,
        title: 'signed-out',
        detail: { kind: 'signed-out' },
        canRetry: false,
      };
    }
    const title: XaiTitle = kind === 'OAuth' ? 'super-grok' : 'api-key';
    if (this.error !== null) {
      return {
        ...base,
        signedIn: true,
        title: 'error',
        detail: { kind: 'error', message: this.error },
        canRetry: true,
      };
    }
    const ready = this.modelsLoaded && selectedModelId !== null && selectedModelId.trim() !== '';
    return {
      ...base,
      signedIn: true,
      title,
      detail: ready
        ? { kind: 'ready', model: selectedModelId, effort }
        : { kind: 'loading-models' },
      canRetry: false,
    };
  }
}
