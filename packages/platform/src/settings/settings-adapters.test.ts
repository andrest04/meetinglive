import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { CancelSource, SUMMARY_MODELS } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonSettingsStore } from '../library/json-settings-store';
import { downloadToFile } from './download-to-file';
import { FileLocalModelStore } from './file-local-model-store';
import { parseGpuReport, SystemHardwareProbe } from './system-hardware-probe';
import { PathCliProbe } from './path-cli-probe';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-settings-adapters-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PathCliProbe (spec 2.2)', () => {
  const touch = (...parts: string[]) => {
    const file = path.join(dir, ...parts);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
    return file;
  };

  it('Windows: tries each PATHEXT extension in each PATH directory', async () => {
    touch('bin', 'claude.CMD');
    const probe = new PathCliProbe({
      platform: 'win32',
      env: { PATH: `${path.join(dir, 'empty')};${path.join(dir, 'bin')}`, PATHEXT: '.EXE;.CMD' },
    });
    expect(await probe.isOnPath('claude')).toBe(true);
    expect(await probe.isOnPath('codex')).toBe(false);
  });

  it('Windows: PATHEXT defaults to .EXE;.CMD;.BAT and a bare name does not count', async () => {
    touch('bin', 'codex.bat');
    touch('bin', 'claude');
    const probe = new PathCliProbe({ platform: 'win32', env: { PATH: path.join(dir, 'bin') } });
    expect(await probe.isOnPath('codex')).toBe(true);
    expect(await probe.isOnPath('claude')).toBe(false);
  });

  it('Windows: an empty PATHEXT or a trailing ; also tries the plain name, as C# does (item 36)', async () => {
    touch('bin', 'claude');
    const bin = path.join(dir, 'bin');
    expect(
      await new PathCliProbe({ platform: 'win32', env: { PATH: bin, PATHEXT: '' } }).isOnPath(
        'claude',
      ),
    ).toBe(true);
    expect(
      await new PathCliProbe({ platform: 'win32', env: { PATH: bin, PATHEXT: '.EXE;' } }).isOnPath(
        'claude',
      ),
    ).toBe(true);
    expect(
      await new PathCliProbe({ platform: 'win32', env: { PATH: bin, PATHEXT: '.EXE' } }).isOnPath(
        'claude',
      ),
    ).toBe(false);
  });

  it('skips blank PATH entries and a missing PATH', async () => {
    touch('bin', 'claude.exe');
    const sep = ';';
    const probe = new PathCliProbe({
      platform: 'win32',
      env: { PATH: `${sep}  ${sep}${path.join(dir, 'bin')}${sep}` },
    });
    expect(await probe.isOnPath('claude')).toBe(true);
    expect(await new PathCliProbe({ platform: 'win32', env: {} }).isOnPath('claude')).toBe(false);
  });

  it('elsewhere: the plain name, split on the OS separator', async () => {
    touch('bin', 'codex');
    const probe = new PathCliProbe({
      platform: 'linux',
      pathSeparator: ':',
      env: { PATH: `/nowhere:${path.join(dir, 'bin')}` },
    });
    expect(await probe.isOnPath('codex')).toBe(true);
    expect(await probe.isOnPath('claude')).toBe(false);
  });

  it('a directory with the right name is not a program', async () => {
    fs.mkdirSync(path.join(dir, 'bin', 'claude.exe'), { recursive: true });
    const probe = new PathCliProbe({ platform: 'win32', env: { PATH: path.join(dir, 'bin') } });
    expect(await probe.isOnPath('claude')).toBe(false);
  });

  it('reads the environment each time, so a later install is seen (B15)', async () => {
    const env: Record<string, string> = { PATH: path.join(dir, 'bin') };
    const probe = new PathCliProbe({ platform: 'win32', env });
    expect(await probe.isOnPath('claude')).toBe(false);
    touch('bin', 'claude.exe');
    expect(await probe.isOnPath('claude')).toBe(true);
  });
});

// ------------------------------------------------------------------ downloading

interface TestServer {
  url: string;
  hits: number;
  close(): Promise<void>;
}

async function serve(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, hits: number) => void,
): Promise<TestServer> {
  const state = { hits: 0 };
  const server = http.createServer((req, res) => {
    state.hits += 1;
    handler(req, res, state.hits);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/model.gguf`,
    get hits() {
      return state.hits;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

describe('downloadToFile', () => {
  const body = Buffer.alloc(300_000, 7);

  it('streams to a .part file, reports percent, then moves it into place', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
    });
    try {
      const target = path.join(dir, 'm', 'model.gguf');
      const percents: number[] = [];
      await downloadToFile({
        url: server.url,
        target,
        onProgress: (p) => percents.push(p),
      });
      expect(fs.readFileSync(target).equals(body)).toBe(true);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
      expect(percents.at(-1)).toBe(100);
      expect(percents.every((p, i) => i === 0 || p >= (percents[i - 1] ?? 0))).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('B5: a server error rejects and leaves nothing behind', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(503);
      res.end('busy');
    });
    try {
      const target = path.join(dir, 'model.gguf');
      await expect(downloadToFile({ url: server.url, target })).rejects.toThrow(/503/);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('a connection that drops half way rejects, never leaves a half file at the target', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      res.write(body.subarray(0, 1000));
      setTimeout(() => res.destroy(), 20);
    });
    try {
      const target = path.join(dir, 'model.gguf');
      await expect(downloadToFile({ url: server.url, target })).rejects.toThrow();
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('cancel stops the transfer and removes the .part file', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': 10_000_000 });
      res.write(Buffer.alloc(10_000));
      // never finishes
    });
    try {
      const target = path.join(dir, 'model.gguf');
      const cancel = new CancelSource();
      const pending = downloadToFile({
        url: server.url,
        target,
        cancel: cancel.signal,
        onProgress: () => {
          cancel.cancel();
        },
      });
      await expect(pending).rejects.toThrow(/cancel/i);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('follows a redirect, as the model host does', async () => {
    const server = await serve((req, res, hits) => {
      if (hits === 1) {
        res.writeHead(302, { location: `${req.url ?? ''}?cdn=1` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-length': 3 });
      res.end('abc');
    });
    try {
      const target = path.join(dir, 'model.gguf');
      await downloadToFile({ url: server.url, target });
      expect(fs.readFileSync(target, 'utf8')).toBe('abc');
    } finally {
      await server.close();
    }
  });

  it('a download without a length reports no percent but completes', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200);
      res.end('abcdef');
    });
    try {
      const target = path.join(dir, 'model.gguf');
      const percents: number[] = [];
      await downloadToFile({ url: server.url, target, onProgress: (p) => percents.push(p) });
      expect(fs.readFileSync(target, 'utf8')).toBe('abcdef');
      expect(percents).toEqual([]);
    } finally {
      await server.close();
    }
  });
});

describe('FileLocalModelStore', () => {
  const model = SUMMARY_MODELS[0]!;

  it('is downloaded exactly when the file is there; a .part file does not count', async () => {
    const store = new FileLocalModelStore({ directory: path.join(dir, 'SummaryModels') });
    expect(await store.isDownloaded(model)).toBe(false);
    fs.mkdirSync(path.join(dir, 'SummaryModels'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SummaryModels', `${model.fileName}.part`), 'x');
    expect(await store.isDownloaded(model)).toBe(false);
    fs.writeFileSync(path.join(dir, 'SummaryModels', model.fileName), 'x');
    expect(await store.isDownloaded(model)).toBe(true);
  });

  it('downloads from the catalog URL (or the test override) into the models folder', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': 4 });
      res.end('GGUF');
    });
    try {
      const directory = path.join(dir, 'SummaryModels');
      const store = new FileLocalModelStore({ directory, urlFor: () => server.url });
      const percents: number[] = [];
      await store.download(model, (p) => percents.push(p), new CancelSource().signal);
      expect(fs.readFileSync(path.join(directory, model.fileName), 'utf8')).toBe('GGUF');
      expect(percents.at(-1)).toBe(100);
      expect(await store.isDownloaded(model)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('delete removes the file and is a no-op when it is not there', async () => {
    const directory = path.join(dir, 'SummaryModels');
    fs.mkdirSync(directory, { recursive: true });
    const store = new FileLocalModelStore({ directory });
    await store.delete(model);
    fs.writeFileSync(path.join(directory, model.fileName), 'x');
    await store.delete(model);
    expect(fs.existsSync(path.join(directory, model.fileName))).toBe(false);
  });

  it('only ever touches files named by the catalog', async () => {
    const store = new FileLocalModelStore({ directory: path.join(dir, 'SummaryModels') });
    const evil = { ...model, fileName: '..\\..\\evil.gguf' };
    await expect(store.isDownloaded(evil)).rejects.toThrow(/catalog/);
    await expect(store.delete(evil)).rejects.toThrow(/catalog/);
  });
});

describe('hardware probe', () => {
  it('reads the largest adapter from the registry report', () => {
    const report = JSON.stringify({
      registry: [
        { Name: 'Intel UHD', Bytes: 1_073_741_824 },
        { Name: 'NVIDIA GeForce RTX 4070', Bytes: 12_884_901_888 },
      ],
      cim: [{ Name: 'NVIDIA GeForce RTX 4070', AdapterRAM: 4_293_918_720 }],
    });
    expect(parseGpuReport(report)).toEqual({ name: 'NVIDIA GeForce RTX 4070', vramGb: 12 });
  });

  it('a single adapter comes as an object and bytes may be a little endian array', () => {
    const bytes = [0, 0, 0, 0, 2, 0, 0, 0]; // 8 GiB
    const report = JSON.stringify({ registry: { Name: 'GPU', Bytes: bytes }, cim: [] });
    expect(parseGpuReport(report)).toEqual({ name: 'GPU', vramGb: 8 });
  });

  it('falls back to the CIM value when the registry has none', () => {
    const report = JSON.stringify({
      registry: [],
      cim: [{ Name: 'Old GPU', AdapterRAM: 2147483648 }],
    });
    expect(parseGpuReport(report)).toEqual({ name: 'Old GPU', vramGb: 2 });
  });

  it('no adapter, unusable output and empty output give no GPU', () => {
    expect(parseGpuReport(JSON.stringify({ registry: [], cim: [] }))).toEqual({
      name: null,
      vramGb: null,
    });
    expect(parseGpuReport('not json')).toEqual({ name: null, vramGb: null });
    expect(parseGpuReport('')).toEqual({ name: null, vramGb: null });
  });

  it('rounds RAM to one decimal and caches the answer', async () => {
    let queries = 0;
    const probe = new SystemHardwareProbe({
      totalMemoryBytes: () => 15.96 * 1024 ** 3,
      queryGpu: () => {
        queries += 1;
        return Promise.resolve({ name: 'GPU', vramGb: 8 });
      },
    });
    expect(await probe.detect()).toEqual({ totalRamGb: 16, gpuName: 'GPU', gpuVramGb: 8 });
    await probe.detect();
    expect(queries).toBe(1);
  });

  it('a failing GPU query still gives the RAM', async () => {
    const probe = new SystemHardwareProbe({
      totalMemoryBytes: () => 8 * 1024 ** 3,
      queryGpu: () => Promise.reject(new Error('powershell missing')),
    });
    expect(await probe.detect()).toEqual({ totalRamGb: 8, gpuName: null, gpuVramGb: null });
  });
});

describe('JsonSettingsStore damage notice (item 101)', () => {
  it('tells the caller where the damaged file was kept', async () => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{ not json');
    const seen: { keptAs: string }[] = [];
    const store = new JsonSettingsStore({
      settingsFilePath: file,
      onDamaged: (info) => seen.push(info),
    });
    const settings = await store.load();
    expect(settings.uiLanguage).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.keptAs).toBe(`${file}.corrupt`);
    expect(fs.existsSync(`${file}.corrupt`)).toBe(true);
  });
});
