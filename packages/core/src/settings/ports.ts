import type { CancelSignal } from '../cancel';
import type { HardwareProfile, SummaryModelInfo } from './summary-models';

/** Port: RAM and GPU of this machine. Adapter: SystemHardwareProbe (platform). */
export interface HardwareProbe {
  detect(): Promise<HardwareProfile>;
}

/** Port: GGUF files on disk. Adapter: FileLocalModelStore (platform). */
export interface LocalModelStore {
  isDownloaded(model: SummaryModelInfo): Promise<boolean>;
  /** Reports 0 to 100. Rejects on failure or cancel and leaves no half file behind. */
  download(
    model: SummaryModelInfo,
    onProgress: (percent: number) => void,
    signal: CancelSignal,
  ): Promise<void>;
  /** No-op when the file is not there. Rejects when the file cannot be removed. */
  delete(model: SummaryModelInfo): Promise<void>;
}

/** Port: is the program on PATH. Adapter: PathCliProbe (platform). */
export interface CliPathProbe {
  isOnPath(executable: string): Promise<boolean>;
}

export type XaiCredentialKind = 'OAuth' | 'ApiKey';

/**
 * Port: the xAI credentials and API. The xAI module owns the adapter (credential store, token
 * refresh, model list). Until it registers one, the Settings page reports the account as
 * unavailable and offers no account controls.
 */
export interface XaiAccountPort {
  /** Reads only the local store. No network. */
  credentialKind(): Promise<XaiCredentialKind | null>;
  /** Refreshes an OAuth token that is near expiry; returns the key for an API key account. */
  getAccessToken(): Promise<string>;
  /** Text chat models only. */
  listModels(accessToken: string): Promise<readonly string[]>;
  /** Trims, stores as an API key account and replaces any OAuth credentials. */
  saveApiKey(key: string): Promise<void>;
  signOut(): Promise<void>;
}

/** Which controls the page may offer, because a module behind them exists. */
export interface SettingsCapabilities {
  /** An `XaiAccountPort` is registered. */
  readonly xaiAccount: boolean;
  /** The SuperGrok device code sign in exists. */
  readonly xaiSignIn: boolean;
  /** Local models can be downloaded. */
  readonly localModels: boolean;
}
