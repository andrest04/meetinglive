import fs from 'node:fs/promises';
import nodePath from 'node:path';
import type { XaiAccountPort, XaiCredentialKind } from '@vozella/core';
import { writeFileAtomic } from '../fs/atomic-write';

/** Encrypts and decrypts a small secret. Electron: `safeStorage`. */
export interface SecretCipher {
  encrypt(plain: string): Promise<Uint8Array>;
  decrypt(blob: Uint8Array): Promise<string>;
}

export type XaiFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FileXaiAccountOptions {
  /** `xai-credentials.bin` in the data root. */
  readonly filePath: string;
  readonly cipher: SecretCipher;
  readonly fetch?: XaiFetch;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

interface StoredCredentials {
  readonly kind: XaiCredentialKind;
  readonly accessToken: string;
}

const API_BASE = 'https://api.x.ai/v1';
const PREFERRED = ['grok-4.6', 'grok-4.7', 'grok-4.3', 'grok-4.5', 'grok-4-fast'];

/**
 * Text chat models only (spec 2.5, `XaiApiClient.IsSummaryChatModel`): image, video, multi agent
 * and build SKUs are dropped, and so are reasoning SKUs other than the non reasoning ones.
 */
export function isSummaryChatModel(modelId: string): boolean {
  if (modelId.trim() === '' || !modelId.toLowerCase().startsWith('grok')) return false;
  const id = modelId.toLowerCase();
  if (['imagine', 'image', 'video', 'multi-agent', 'build'].some((part) => id.includes(part))) {
    return false;
  }
  return !(id.endsWith('-reasoning') && !id.endsWith('-non-reasoning'));
}

function rank(id: string): number {
  const index = PREFERRED.findIndex((p) => p.toLowerCase() === id.toLowerCase());
  return index === -1 ? PREFERRED.length : index;
}

/**
 * The xAI account behind Settings: the credentials in an encrypted file and the model list over
 * HTTPS. It stores API keys. A SuperGrok sign in writes the same file as kind `OAuth`; the
 * device code flow and the token refresh belong to the xAI module, so an OAuth token is used as
 * it is. Nothing here writes the key to settings.json or to a log.
 */
export class FileXaiAccount implements XaiAccountPort {
  constructor(private readonly options: FileXaiAccountOptions) {}

  async credentialKind(): Promise<XaiCredentialKind | null> {
    return (await this.read())?.kind ?? null;
  }

  async getAccessToken(): Promise<string> {
    const stored = await this.read();
    if (stored === null) throw new Error('Not signed in to Grok (xAI).');
    return stored.accessToken;
  }

  async listModels(accessToken: string): Promise<readonly string[]> {
    const doFetch = this.options.fetch ?? ((url, init) => fetch(url, init));
    const response = await doFetch(`${this.options.baseUrl ?? API_BASE}/models`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
    });
    if (!response.ok) {
      throw new Error(`Grok (xAI) answered ${response.status.toString()}.`);
    }
    const body = (await response.json()) as { data?: unknown };
    const items = Array.isArray(body.data) ? (body.data as { id?: unknown }[]) : [];
    const ids: string[] = [];
    for (const item of items) {
      const id = typeof item.id === 'string' ? item.id : '';
      if (isSummaryChatModel(id) && !ids.some((x) => x.toLowerCase() === id.toLowerCase())) {
        ids.push(id);
      }
    }
    return ids.sort((a, b) => rank(a) - rank(b) || a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  async saveApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (trimmed === '') throw new Error('The key is empty.');
    const payload: StoredCredentials = { kind: 'ApiKey', accessToken: trimmed };
    await fs.mkdir(nodePath.dirname(this.options.filePath), { recursive: true });
    await writeFileAtomic(
      this.options.filePath,
      await this.options.cipher.encrypt(JSON.stringify(payload)),
    );
  }

  async signOut(): Promise<void> {
    await fs.rm(this.options.filePath, { force: true });
  }

  private async read(): Promise<StoredCredentials | null> {
    let blob: Buffer;
    try {
      blob = await fs.readFile(this.options.filePath);
    } catch {
      return null;
    }
    if (blob.length === 0) return null;
    try {
      const parsed = JSON.parse(
        await this.options.cipher.decrypt(blob),
      ) as Partial<StoredCredentials>;
      const kind = parsed.kind;
      const token = parsed.accessToken;
      if (
        (kind !== 'ApiKey' && kind !== 'OAuth') ||
        typeof token !== 'string' ||
        token.trim() === ''
      ) {
        return null;
      }
      return { kind, accessToken: token };
    } catch {
      return null;
    }
  }
}
