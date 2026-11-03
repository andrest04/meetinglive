import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { CancelSource, LLAMA_BACKENDS, RuntimeInUseError, type LlamaBackend } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bsdtarPath } from '../transcription/zip-extractor';
import { selectWorkingBackend, llamaVersionSelfTest } from './backend-choice';
import { LLAMA_RUNTIMES, LLAMA_TAG, type LlamaRuntimePin } from './llama-runtime-catalog';
import { LlamaRuntimeManager } from './llama-runtime-manager';

let dir = '';
const servers: (() => Promise<void>)[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-llama-'));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((close) => close()));
  fs.rmSync(dir, { recursive: true, force: true });
});

const sha = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** A real zip built with the system bsdtar, holding `files` at its top level. */
function makeZip(name: string, files: Record<string, string>): Buffer {
  const src = fs.mkdtempSync(path.join(dir, 'src-'));
  for (const [file, content] of Object.entries(files))
    fs.writeFileSync(path.join(src, file), content);
  const zip = path.join(dir, `made-${name}`);
  execFileSync(bsdtarPath(), ['-a', '-cf', zip, '-C', src, ...Object.keys(files)]);
  const data = fs.readFileSync(zip);
  fs.rmSync(zip);
  return data;
}

interface Served {
  readonly baseUrl: string;
  readonly hits: Map<string, number>;
}

async function serve(
  files: Record<string, Buffer>,
  slow?: { name: string; started: () => void },
): Promise<Served> {
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').slice(1));
    hits.set(name, (hits.get(name) ?? 0) + 1);
    const body = files[name];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-length': body.length });
    if (slow?.name === name) {
      res.write(body.subarray(0, 10));
      slow.started();
      return; // never finishes: the test cancels
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  servers.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  );
  return { baseUrl: `http://127.0.0.1:${String(port)}`, hits };
}

const llamaZip = makeZipLazy('llama.zip', { 'llama-server.exe': 'exe', 'ggml.dll': 'dll' });
const cudartZip = makeZipLazy('cudart.zip', { 'cudart64_12.dll': 'rt' });
function makeZipLazy(name: string, files: Record<string, string>): () => Buffer {
  let cached: Buffer | undefined;
  return () => (cached ??= makeZip(name, files));
}

function pins(llama: Buffer, cudart: Buffer): Record<LlamaBackend, LlamaRuntimePin> {
  const one = (backend: LlamaBackend): LlamaRuntimePin => ({
    backend,
    folder: backend,
    archives: [{ name: `${backend}.zip`, sha256: sha(llama) }],
  });
  return {
    cpu: one('cpu'),
    vulkan: one('vulkan'),
    cuda13: one('cuda13'),
    cuda12: {
      backend: 'cuda12',
      folder: 'cuda12',
      archives: [
        { name: 'cuda12.zip', sha256: sha(llama) },
        { name: 'cudart.zip', sha256: sha(cudart) },
      ],
    },
  };
}

function setup(): { llama: Buffer; cudart: Buffer; root: string } {
  return { llama: llamaZip(), cudart: cudartZip(), root: path.join(dir, 'LlamaRuntime') };
}

describe('llama runtime catalog', () => {
  it('pins tag b12063 and the four Windows backends exactly as the spike', () => {
    expect(LLAMA_TAG).toBe('b12063');
    expect([...LLAMA_BACKENDS].sort()).toEqual(Object.keys(LLAMA_RUNTIMES).sort());
    expect(LLAMA_RUNTIMES.cuda12.archives.map((a) => [a.name, a.sha256])).toEqual([
      [
        'llama-b12063-bin-win-cuda-12.4-x64.zip',
        'e259b36002d9f20c8ac4238f0a043e614c43d32f533888c61bf0da34cba4924f',
      ],
      [
        'cudart-llama-bin-win-cuda-12.4-x64.zip',
        '8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6',
      ],
    ]);
    expect(LLAMA_RUNTIMES.cuda13.archives.map((a) => [a.name, a.sha256])).toEqual([
      [
        'llama-b12063-bin-win-cuda-13.4-x64.zip',
        '5d1b4eef94ef80668284e5ef2ffe5c8abbac61968cccb5463d97c2e6416f2a3a',
      ],
      [
        'cudart-llama-bin-win-cuda-13.4-x64.zip',
        '738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668',
      ],
    ]);
    expect(LLAMA_RUNTIMES.vulkan.archives.map((a) => [a.name, a.sha256])).toEqual([
      [
        'llama-b12063-bin-win-vulkan-x64.zip',
        '7f2b50e5aa9b84b1fdf2a77790ac899a2a7d21160f8f806eefd6d177fa81bae0',
      ],
    ]);
    expect(LLAMA_RUNTIMES.cpu.archives.map((a) => [a.name, a.sha256])).toEqual([
      [
        'llama-b12063-bin-win-cpu-x64.zip',
        '4e3766c32a517cdd66ea28f57c862d6b83582ba5d1354f9db585b34f7ad8cf62',
      ],
    ]);
  });
});

describe('LlamaRuntimeManager', () => {
  it('downloads, verifies, extracts both archives into one folder and removes the archives', async () => {
    const { llama, cudart, root } = setup();
    const served = await serve({ 'cuda12.zip': llama, 'cudart.zip': cudart });
    const manager = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      baseUrl: served.baseUrl,
    });
    expect(manager.isReady('cuda12')).toBe(false);
    expect(() => manager.binDirectory('cuda12')).toThrow(/not installed/);

    const percents: number[] = [];
    const exe = await manager.ensure('cuda12', (p) => percents.push(p));

    expect(exe).toBe(path.join(root, 'cuda12', 'llama-server.exe'));
    expect(manager.isReady('cuda12')).toBe(true);
    expect(manager.binDirectory('cuda12')).toBe(path.join(root, 'cuda12'));
    expect(fs.existsSync(path.join(root, 'cuda12', 'cudart64_12.dll'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'cuda12.incomplete'))).toBe(false);
    expect(fs.readdirSync(root)).toEqual(['cuda12']);
    expect(percents.at(-1)).toBe(100);
    expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  });

  it('shares one install between concurrent callers and skips the network once ready', async () => {
    const { llama, cudart, root } = setup();
    const served = await serve({ 'cpu.zip': llama });
    const manager = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      baseUrl: served.baseUrl,
    });
    const [a, b] = await Promise.all([manager.ensure('cpu'), manager.ensure('cpu')]);
    expect(a).toBe(b);
    expect(served.hits.get('cpu.zip')).toBe(1);
    await manager.ensure('cpu');
    expect(served.hits.get('cpu.zip')).toBe(1);
  });

  it('removes the archive and installs nothing on a checksum mismatch', async () => {
    const { llama, cudart, root } = setup();
    const served = await serve({ 'cpu.zip': Buffer.from('not the pinned archive') });
    const manager = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      baseUrl: served.baseUrl,
    });
    await expect(manager.ensure('cpu')).rejects.toThrow();
    expect(manager.isReady('cpu')).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('leaves no half folder when the user cancels mid-download', async () => {
    const { llama, cudart, root } = setup();
    const cancel = new CancelSource();
    const served = await serve(
      { 'cpu.zip': llama },
      { name: 'cpu.zip', started: () => setTimeout(() => cancel.cancel(), 20) },
    );
    const manager = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      baseUrl: served.baseUrl,
    });
    await expect(manager.ensure('cpu', () => undefined, cancel)).rejects.toThrow(/cancel/i);
    expect(manager.isReady('cpu')).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
    // a later install still works
    const again = await serve({ 'cpu.zip': llama });
    const retry = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      baseUrl: again.baseUrl,
    });
    await retry.ensure('cpu');
    expect(retry.isReady('cpu')).toBe(true);
  });

  it('does not report ready after an interrupted extract', async () => {
    const { llama, cudart, root } = setup();
    const served = await serve({ 'cpu.zip': llama });
    const manager = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      baseUrl: served.baseUrl,
      extract: (_zip, destination) => {
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(destination, 'ggml.dll'), 'half');
        return Promise.reject(new Error('extract interrupted'));
      },
    });
    await expect(manager.ensure('cpu')).rejects.toThrow('extract interrupted');
    expect(manager.isReady('cpu')).toBe(false);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('keeps the marker and no folder when the extracted tree has no server executable', async () => {
    const { llama, cudart, root } = setup();
    const served = await serve({ 'cpu.zip': llama });
    const manager = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      baseUrl: served.baseUrl,
      extract: (_zip, destination) => {
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(destination, 'ggml.dll'), 'only a dll');
        return Promise.resolve();
      },
    });
    await expect(manager.ensure('cpu')).rejects.toThrow(/llama-server\.exe was not found/);
    expect(manager.isReady('cpu')).toBe(false);
    expect(fs.existsSync(path.join(root, 'cpu'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'cpu.incomplete'))).toBe(true);
  });

  it('treats a folder with a marker as not ready even when the executable is there', () => {
    const { llama, cudart, root } = setup();
    fs.mkdirSync(path.join(root, 'cpu'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cpu', 'llama-server.exe'), 'exe');
    const manager = new LlamaRuntimeManager({ root, runtimes: pins(llama, cudart) });
    expect(manager.isReady('cpu')).toBe(true);
    fs.writeFileSync(path.join(root, 'cpu.incomplete'), '');
    expect(manager.isReady('cpu')).toBe(false);
  });

  it('refuses to delete while a file is held open and removes nothing', async () => {
    const { llama, cudart, root } = setup();
    fs.mkdirSync(path.join(root, 'cpu'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cpu', 'llama-server.exe'), 'exe');
    fs.writeFileSync(path.join(root, 'cpu', 'ggml.dll'), 'dll');
    const manager = new LlamaRuntimeManager({
      root,
      runtimes: pins(llama, cudart),
      probeFile: (file) => {
        if (file.endsWith('llama-server.exe')) {
          throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        }
      },
    });
    await expect(manager.delete('cpu')).rejects.toBeInstanceOf(RuntimeInUseError);
    expect(manager.isReady('cpu')).toBe(true);
    expect(fs.existsSync(path.join(root, 'cpu', 'ggml.dll'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'cpu.incomplete'))).toBe(false);
  });

  it('deletes an unlocked backend and leaves the others', async () => {
    const { llama, cudart, root } = setup();
    for (const backend of ['cpu', 'vulkan']) {
      fs.mkdirSync(path.join(root, backend), { recursive: true });
      fs.writeFileSync(path.join(root, backend, 'llama-server.exe'), 'exe');
    }
    const manager = new LlamaRuntimeManager({ root, runtimes: pins(llama, cudart) });
    await manager.delete('cpu');
    expect(manager.isReady('cpu')).toBe(false);
    expect(fs.existsSync(path.join(root, 'cpu'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'cpu.incomplete'))).toBe(false);
    expect(manager.isReady('vulkan')).toBe(true);
    await expect(manager.delete('cpu')).resolves.toBeUndefined();
  });

  it('finds the executable one folder down when an archive wraps its files', () => {
    const { llama, cudart, root } = setup();
    fs.mkdirSync(path.join(root, 'cpu', 'build'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cpu', 'build', 'llama-server.exe'), 'exe');
    const manager = new LlamaRuntimeManager({ root, runtimes: pins(llama, cudart) });
    expect(manager.binDirectory('cpu')).toBe(path.join(root, 'cpu', 'build'));
  });
});

describe('selectWorkingBackend', () => {
  const nvidia = { gpuName: 'NVIDIA GeForce RTX 3060', gpuVramGb: 12 };

  function fakeManager(): {
    manager: {
      ensure: (b: LlamaBackend) => Promise<string>;
      binDirectory: (b: LlamaBackend) => string;
    };
    ensured: LlamaBackend[];
  } {
    const ensured: LlamaBackend[] = [];
    return {
      ensured,
      manager: {
        ensure: (b) => {
          ensured.push(b);
          return Promise.resolve(`C:\\rt\\${b}\\llama-server.exe`);
        },
        binDirectory: (b) => `C:\\rt\\${b}`,
      },
    };
  }

  it('uses cuda12 on NVIDIA when it passes its self-test', async () => {
    const { manager, ensured } = fakeManager();
    const chosen = await selectWorkingBackend({
      hardware: nvidia,
      manager,
      selfTest: () => Promise.resolve(true),
    });
    expect(chosen.backend).toBe('cuda12');
    expect(chosen.failed).toEqual([]);
    expect(ensured).toEqual(['cuda12']);
  });

  it('falls back cuda12 -> vulkan -> cpu when the self-tests fail', async () => {
    const { manager, ensured } = fakeManager();
    const chosen = await selectWorkingBackend({
      hardware: nvidia,
      manager,
      selfTest: (exe) => Promise.resolve(exe.includes('\\cpu\\')),
    });
    expect(chosen.backend).toBe('cpu');
    expect(chosen.failed).toEqual(['cuda12', 'vulkan']);
    expect(ensured).toEqual(['cuda12', 'vulkan', 'cpu']);
  });

  it('asks for cuda13 only when the injected driver probe reports it', async () => {
    const { manager, ensured } = fakeManager();
    await selectWorkingBackend({
      hardware: nvidia,
      manager,
      cudaProbe: () => Promise.resolve('cuda13'),
      selfTest: () => Promise.resolve(true),
    });
    expect(ensured).toEqual(['cuda13']);
  });

  it('picks vulkan for AMD and cpu with no GPU', async () => {
    const amd = fakeManager();
    expect(
      (
        await selectWorkingBackend({
          hardware: { gpuName: 'AMD Radeon RX 7800 XT', gpuVramGb: 16 },
          manager: amd.manager,
          selfTest: () => Promise.resolve(true),
        })
      ).backend,
    ).toBe('vulkan');
    const none = fakeManager();
    expect(
      (
        await selectWorkingBackend({
          hardware: { gpuName: null, gpuVramGb: null },
          manager: none.manager,
          selfTest: () => Promise.resolve(true),
        })
      ).backend,
    ).toBe('cpu');
  });

  it('skips backends already known to fail and rejects when the chain is used up', async () => {
    const { manager, ensured } = fakeManager();
    const chosen = await selectWorkingBackend({
      hardware: nvidia,
      manager,
      failed: ['cuda12'],
      selfTest: () => Promise.resolve(true),
    });
    expect(chosen.backend).toBe('vulkan');
    expect(ensured).toEqual(['vulkan']);
    await expect(
      selectWorkingBackend({
        hardware: { gpuName: null, gpuVramGb: null },
        manager,
        selfTest: () => Promise.resolve(false),
      }),
    ).rejects.toThrow(/self-test/);
  });

  it('lets an install error propagate instead of falling back', async () => {
    const { manager } = fakeManager();
    await expect(
      selectWorkingBackend({
        hardware: nvidia,
        manager: { ...manager, ensure: () => Promise.reject(new Error('offline')) },
        selfTest: () => Promise.resolve(true),
      }),
    ).rejects.toThrow('offline');
  });
});

describe('llamaVersionSelfTest', () => {
  it('is false for a program that does not exist', async () => {
    expect(await llamaVersionSelfTest(path.join(dir, 'missing.exe'), dir)).toBe(false);
  });

  it.runIf(process.platform === 'win32')('is true for a program that exits 0', async () => {
    expect(await llamaVersionSelfTest(process.execPath, dir)).toBe(true);
  });
});
