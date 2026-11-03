import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileXaiAccount, isSummaryChatModel, type SecretCipher } from './file-xai-account';

// A reversible stand in for safeStorage that does not leave the text readable on disk.
const cipher: SecretCipher = {
  encrypt: (plain) => Promise.resolve(Buffer.from(`enc:${Buffer.from(plain).toString('base64')}`)),
  decrypt: (blob) =>
    Promise.resolve(Buffer.from(Buffer.from(blob).toString().slice(4), 'base64').toString()),
};

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-xai-'));
  file = path.join(dir, 'xai-credentials.safe.bin');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const account = (extra: Partial<ConstructorParameters<typeof FileXaiAccount>[0]> = {}) =>
  new FileXaiAccount({ filePath: file, cipher, ...extra });

describe('FileXaiAccount credentials', () => {
  it('starts signed out and says so without a file or with an unreadable one', async () => {
    expect(await account().credentialKind()).toBeNull();
    fs.writeFileSync(file, 'not encrypted');
    expect(await account().credentialKind()).toBeNull();
    await expect(account().getAccessToken()).rejects.toThrow('Not signed in');
  });

  it('saves a trimmed key, never in plain text, and reads it back as an API key account', async () => {
    const a = account();
    await a.saveApiKey('  xai-secret-123  ');
    expect(await a.credentialKind()).toBe('ApiKey');
    expect(await a.getAccessToken()).toBe('xai-secret-123');
    expect(fs.readFileSync(file).includes('xai-secret-123')).toBe(false);
  });

  it('refuses a blank key and keeps what was saved', async () => {
    const a = account();
    await a.saveApiKey('first');
    await expect(a.saveApiKey('   ')).rejects.toThrow();
    expect(await a.getAccessToken()).toBe('first');
  });

  it('signs out by removing the file, and signing out twice is fine', async () => {
    const a = account();
    await a.saveApiKey('k');
    await a.signOut();
    await a.signOut();
    expect(fs.existsSync(file)).toBe(false);
    expect(await a.credentialKind()).toBeNull();
  });

  it('reports an OAuth account written by the sign in module', async () => {
    fs.writeFileSync(
      file,
      await cipher.encrypt(JSON.stringify({ kind: 'OAuth', accessToken: 'jwt' })),
    );
    expect(await account().credentialKind()).toBe('OAuth');
  });
});

describe('FileXaiAccount.listModels', () => {
  const reply = (ids: unknown[], ok = true, status = 200) => ({
    ok,
    status,
    json: () => Promise.resolve({ data: ids.map((id) => ({ id })) }),
  });

  it('sends the bearer token and keeps text chat models in the preferred order', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const a = account({
      fetch: (url, init) => {
        seen.push({ url, auth: init.headers.Authorization });
        return Promise.resolve(
          reply([
            'grok-4-fast',
            'grok-imagine-video',
            'grok-4.3',
            'GROK-4.6',
            'grok-4.6',
            'grok-code-build',
            'grok-4-reasoning',
            'grok-4-non-reasoning',
            'other-model',
            42,
          ]),
        );
      },
      baseUrl: 'http://127.0.0.1:1/v1',
    });
    expect(await a.listModels('tok')).toEqual([
      'GROK-4.6',
      'grok-4.3',
      'grok-4-fast',
      'grok-4-non-reasoning',
    ]);
    expect(seen).toEqual([{ url: 'http://127.0.0.1:1/v1/models', auth: 'Bearer tok' }]);
  });

  it('turns a refusal into an error the page shows', async () => {
    const a = account({ fetch: () => Promise.resolve(reply([], false, 401)) });
    await expect(a.listModels('bad')).rejects.toThrow('Grok (xAI) answered 401.');
  });

  it('treats an unexpected body as no models', async () => {
    const a = account({
      fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    });
    expect(await a.listModels('t')).toEqual([]);
  });
});

describe('isSummaryChatModel', () => {
  it('matches the C# filter', () => {
    expect(isSummaryChatModel('grok-4.6')).toBe(true);
    expect(isSummaryChatModel('grok-4-non-reasoning')).toBe(true);
    for (const id of ['', 'gpt-5', 'grok-image-1', 'grok-4-reasoning', 'grok-multi-agent']) {
      expect(isSummaryChatModel(id), id).toBe(false);
    }
  });
});
