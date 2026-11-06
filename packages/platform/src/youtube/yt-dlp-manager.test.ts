import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Logger } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YT_DLP_RELEASE_URL, YtDlpInstallError, YtDlpManager } from './yt-dlp-manager';

const EXE_URL = `${YT_DLP_RELEASE_URL}/yt-dlp.exe`;
const SUMS_URL = `${YT_DLP_RELEASE_URL}/SHA2-256SUMS`;
const EXE_BYTES = Buffer.from('MZ fake yt-dlp binary');
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const sumsWith = (hash: string): string =>
  [
    `${sha(Buffer.from('other'))}  yt-dlp`,
    `${hash}  yt-dlp.exe`,
    `${sha(Buffer.from('x86'))}  yt-dlp_x86.exe`,
    `${sha(Buffer.from('zip'))}  yt-dlp.exe.zip`,
  ].join('\n');

let binDir: string;
let root: string;
beforeEach(() => {
  const base = process.env.VOZELLA_DATA_ROOT ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  root = fs.mkdtempSync(path.join(base, 'yt-dlp-manager-'));
  binDir = path.join(root, 'bin');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn((input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const route = routes[url];
    return Promise.resolve(route ? route() : new Response('missing', { status: 404 }));
  });
}

const okRoutes = (sums = sumsWith(sha(EXE_BYTES)), exe = EXE_BYTES) => ({
  [SUMS_URL]: () => new Response(sums),
  [EXE_URL]: () => new Response(exe),
});

const silentLogger = () => ({
  debug: vi.fn<Logger['debug']>(),
  info: vi.fn<Logger['info']>(),
  warn: vi.fn<Logger['warn']>(),
  error: vi.fn<Logger['error']>(),
});

const filesIn = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir) : []);

describe('YtDlpManager.ensure', () => {
  it('downloads yt-dlp.exe, verifies it against SHA2-256SUMS and returns its path', async () => {
    const fetch = fakeFetch(okRoutes());
    const manager = new YtDlpManager({ binDir, fetch });

    const exe = await manager.ensure();

    expect(exe).toBe(path.join(binDir, 'yt-dlp.exe'));
    expect(fs.readFileSync(exe)).toEqual(EXE_BYTES);
    expect(filesIn(binDir)).toEqual(['yt-dlp.exe']);
    expect(manager.isInstalled()).toBe(true);
  });

  it('does not download when the executable is already there', async () => {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'yt-dlp.exe'), 'existing');
    const fetch = fakeFetch(okRoutes());

    await new YtDlpManager({ binDir, fetch }).ensure();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('removes the file and throws a checksum-mismatch error when the hash differs', async () => {
    const fetch = fakeFetch(okRoutes(sumsWith(sha(Buffer.from('something else')))));
    const manager = new YtDlpManager({ binDir, fetch });

    const error = await manager.ensure().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(YtDlpInstallError);
    expect((error as YtDlpInstallError).reason).toBe('checksum-mismatch');
    expect(filesIn(binDir)).toEqual([]);
    expect(manager.isInstalled()).toBe(false);
  });

  it('throws checksum-missing and downloads nothing when SUMS has no yt-dlp.exe line', async () => {
    const sums = `${sha(EXE_BYTES)}  yt-dlp_x86.exe\n${sha(EXE_BYTES)}  yt-dlp.exe.zip\n`;
    const fetch = fakeFetch(okRoutes(sums));

    const error = await new YtDlpManager({ binDir, fetch }).ensure().catch((e: unknown) => e);

    expect((error as YtDlpInstallError).reason).toBe('checksum-missing');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(filesIn(binDir)).toEqual([]);
  });

  it('accepts the binary-mode marker in the SUMS line', async () => {
    const fetch = fakeFetch(okRoutes(`${sha(EXE_BYTES).toUpperCase()} *yt-dlp.exe\r\n`));
    await expect(new YtDlpManager({ binDir, fetch }).ensure()).resolves.toMatch(/yt-dlp\.exe$/);
  });

  it('maps an HTTP failure to download-failed and leaves no file', async () => {
    const fetch = fakeFetch({ [SUMS_URL]: () => new Response(sumsWith(sha(EXE_BYTES))) });

    const error = await new YtDlpManager({ binDir, fetch }).ensure().catch((e: unknown) => e);

    expect((error as YtDlpInstallError).reason).toBe('download-failed');
    expect(filesIn(binDir)).toEqual([]);
  });

  it('shares one download between concurrent callers', async () => {
    const fetch = fakeFetch(okRoutes());
    const manager = new YtDlpManager({ binDir, fetch });

    const [a, b, c] = await Promise.all([manager.ensure(), manager.ensure(), manager.ensure()]);

    expect(new Set([a, b, c]).size).toBe(1);
    const exeCalls = fetch.mock.calls.filter(([url]) => url === EXE_URL);
    expect(exeCalls).toHaveLength(1);
  });

  it('retries on the next call after a failed download', async () => {
    let first = true;
    const fetch = fakeFetch({
      [SUMS_URL]: () => new Response(sumsWith(sha(EXE_BYTES))),
      [EXE_URL]: () => {
        if (first) {
          first = false;
          return new Response('nope', { status: 503 });
        }
        return new Response(EXE_BYTES);
      },
    });
    const manager = new YtDlpManager({ binDir, fetch });

    await expect(manager.ensure()).rejects.toBeInstanceOf(YtDlpInstallError);
    await expect(manager.ensure()).resolves.toMatch(/yt-dlp\.exe$/);
  });
});

describe('YtDlpManager.update', () => {
  const installed = (): void => {
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'yt-dlp.exe'), 'existing');
  };

  it('runs the self-update at most once per session', async () => {
    installed();
    const runSelfUpdate = vi.fn(() => Promise.resolve());
    const manager = new YtDlpManager({ binDir, fetch: fakeFetch({}), runSelfUpdate });

    await manager.update();
    await manager.update();

    expect(runSelfUpdate).toHaveBeenCalledTimes(1);
    expect(runSelfUpdate).toHaveBeenCalledWith(path.join(binDir, 'yt-dlp.exe'));
  });

  it('swallows and logs a failed self-update, and does not try again', async () => {
    installed();
    const logger = silentLogger();
    const runSelfUpdate = vi.fn(() => Promise.reject(new Error('network down')));
    const manager = new YtDlpManager({ binDir, fetch: fakeFetch({}), runSelfUpdate, logger });

    await expect(manager.update()).resolves.toBeUndefined();
    await expect(manager.update()).resolves.toBeUndefined();

    expect(runSelfUpdate).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('skips the self-update when this session just downloaded the latest release', async () => {
    const runSelfUpdate = vi.fn(() => Promise.resolve());
    const manager = new YtDlpManager({ binDir, fetch: fakeFetch(okRoutes()), runSelfUpdate });

    await manager.ensure();
    await manager.update();

    expect(runSelfUpdate).not.toHaveBeenCalled();
  });

  it('never rejects when the executable cannot be installed', async () => {
    const logger = silentLogger();
    const runSelfUpdate = vi.fn(() => Promise.resolve());
    const manager = new YtDlpManager({ binDir, fetch: fakeFetch({}), runSelfUpdate, logger });

    await expect(manager.update()).resolves.toBeUndefined();
    expect(runSelfUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
