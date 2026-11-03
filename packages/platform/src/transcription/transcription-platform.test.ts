import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  CancelSource,
  NEMO_RUNTIME_DLL,
  RuntimeInUseError,
  type AsrBackend,
  type PinnedFile,
  type PinnedRuntime,
} from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadToFile } from '../settings/download-to-file';
import { writeWav } from '../audio/wav-test-kit';
import { NemotronModelStore } from './model-store';
import { findLibraryDirectory, NemoSpeechRuntimeManager } from './runtime-manager';
import { WavFrameReader } from './wav-frame-reader';
import { extractZipWithTar } from './zip-extractor';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-asr-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const sha = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;
async function serve(handler: Handler): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${String(port)}/file`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

describe('downloader additions (B5)', () => {
  const body = Buffer.alloc(200_000, 3);

  it('continues a broken transfer with a Range request and checks the checksum', async () => {
    let attempts = 0;
    const ranges: (string | undefined)[] = [];
    const server = await serve((req, res) => {
      attempts += 1;
      ranges.push(req.headers.range);
      if (attempts === 1) {
        res.writeHead(200, { 'content-length': body.length });
        res.write(body.subarray(0, 50_000));
        setTimeout(() => res.destroy(), 20);
        return;
      }
      const from = Number(/bytes=(\d+)-/.exec(req.headers.range ?? '')?.[1] ?? 0);
      res.writeHead(206, { 'content-length': body.length - from });
      res.end(body.subarray(from));
    });
    try {
      const target = path.join(dir, 'm.gguf');
      const options = { url: server.url, target, sha256: sha(body), resume: true };
      await expect(downloadToFile(options)).rejects.toThrow();
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(`${target}.part`)).toBe(true);
      await downloadToFile(options);
      expect(fs.readFileSync(target).equals(body)).toBe(true);
      expect(ranges[1]).toMatch(/^bytes=\d+-$/);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('starts over when the server ignores the Range header', async () => {
    let first = true;
    const server = await serve((_req, res) => {
      if (first) {
        first = false;
        res.writeHead(200, { 'content-length': body.length });
        res.write(body.subarray(0, 1000));
        setTimeout(() => res.destroy(), 20);
        return;
      }
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
    });
    try {
      const target = path.join(dir, 'm.gguf');
      await expect(downloadToFile({ url: server.url, target, resume: true })).rejects.toThrow();
      await downloadToFile({ url: server.url, target, resume: true });
      expect(fs.readFileSync(target).equals(body)).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('a checksum mismatch removes the file and says so', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      res.end(body);
    });
    try {
      const target = path.join(dir, 'm.gguf');
      await expect(
        downloadToFile({ url: server.url, target, sha256: 'a'.repeat(64), resume: true }),
      ).rejects.toThrow(/SHA-256 mismatch/);
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('a stalled connection ends instead of hanging', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      res.write(body.subarray(0, 100));
    });
    try {
      const target = path.join(dir, 'm.gguf');
      await expect(
        downloadToFile({ url: server.url, target, stallTimeoutMs: 150 }),
      ).rejects.toThrow(/stalled/);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('a cancel removes the part file even when resume is on', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': body.length });
      res.write(body.subarray(0, 100));
    });
    try {
      const target = path.join(dir, 'm.gguf');
      const cancel = new CancelSource();
      const pending = downloadToFile({ url: server.url, target, resume: true, cancel });
      setTimeout(() => {
        cancel.cancel();
      }, 100);
      await expect(pending).rejects.toThrow(/cancelled/);
      expect(fs.existsSync(`${target}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });
});

describe('NemotronModelStore', () => {
  const content = Buffer.from('model bytes');
  const file = (url: string, name = 'asr.q8_0.gguf'): PinnedFile => ({
    fileName: name,
    displayName: 'x',
    url,
    sha256: sha(content),
    bytes: content.length,
  });
  const diar = (url: string): PinnedFile => ({ ...file(url, 'diar.q8_0.gguf') });
  const store = (url = 'http://127.0.0.1:1/'): NemotronModelStore =>
    new NemotronModelStore({
      directory: path.join(dir, 'TranscriptionModels'),
      files: { asr: file(url), diarization: diar(url) },
    });

  it('GetModelPath_CombinesModelsDirectoryAndCatalogFileName', () => {
    expect(store().modelPath()).toBe(path.join(dir, 'TranscriptionModels', 'asr.q8_0.gguf'));
    expect(store().diarizationModelPath()).toBe(
      path.join(dir, 'TranscriptionModels', 'diar.q8_0.gguf'),
    );
  });

  it('IsModelDownloaded_WhenFileMissing_ReturnsFalse, and a .part file does not count', () => {
    const models = store();
    expect(models.isModelDownloaded()).toBe(false);
    expect(models.isDiarizationModelDownloaded()).toBe(false);
    fs.mkdirSync(path.join(dir, 'TranscriptionModels'));
    fs.writeFileSync(`${models.modelPath()}.part`, 'x');
    expect(models.isModelDownloaded()).toBe(false);
  });

  it('DownloadModelAsync_WritesResponseBytesToModelPath (both files)', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(200, { 'content-length': content.length });
      res.end(content);
    });
    try {
      const models = store(server.url);
      await models.download(file(server.url), () => undefined);
      await models.download(diar(server.url), () => undefined);
      expect(fs.readFileSync(models.modelPath()).equals(content)).toBe(true);
      expect(models.isDiarizationModelDownloaded()).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('DownloadModelAsync_WhenRequestFails_DoesNotLeaveAPartialFile', async () => {
    const server = await serve((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    try {
      const models = store(server.url);
      await expect(models.download(file(server.url), () => undefined)).rejects.toThrow(/500/);
      expect(models.isModelDownloaded()).toBe(false);
      expect(fs.existsSync(`${models.modelPath()}.part`)).toBe(false);
    } finally {
      await server.close();
    }
  });

  it('DeleteModel removes the file and tolerates a missing one', async () => {
    const models = store();
    await models.deleteModel();
    await models.deleteDiarizationModel();
    fs.mkdirSync(path.join(dir, 'TranscriptionModels'));
    fs.writeFileSync(models.modelPath(), 'x');
    await models.deleteModel();
    expect(models.isModelDownloaded()).toBe(false);
  });

  it('B17: two callers for the same file share one transfer', async () => {
    let hits = 0;
    const server = await serve((_req, res) => {
      hits += 1;
      setTimeout(() => {
        res.writeHead(200, { 'content-length': content.length });
        res.end(content);
      }, 60);
    });
    try {
      const models = store(server.url);
      await Promise.all([
        models.download(file(server.url), () => undefined),
        models.download(file(server.url), () => undefined),
      ]);
      expect(hits).toBe(1);
      expect(models.isModelDownloaded()).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('refuses a file that is not part of the engine', async () => {
    await expect(store().download(file('http://x/', 'evil.gguf'), () => undefined)).rejects.toThrow(
      /not a model/,
    );
  });
});

describe('NemoSpeechRuntimeManager', () => {
  const root = (): string => path.join(dir, 'NemoSpeech');
  const dllIn = (folder: string): string => path.join(folder, 'bin', NEMO_RUNTIME_DLL);
  const putRuntime = (name: string): void => {
    fs.mkdirSync(path.join(root(), name, 'bin'), { recursive: true });
    fs.writeFileSync(dllIn(path.join(root(), name)), 'dll');
  };
  const manager = (
    extra: Partial<ConstructorParameters<typeof NemoSpeechRuntimeManager>[0]> = {},
  ) => new NemoSpeechRuntimeManager({ root: root(), sleep: () => Promise.resolve(), ...extra });

  it('IsReady_WhenDummyDllMissing_ReturnsFalse / WhenDummyDllExists_ReturnsTrue', () => {
    const m = manager();
    expect(m.isReady('cpu')).toBe(false);
    putRuntime('cpu');
    expect(m.isReady('cpu')).toBe(true);
    expect(m.binDirectory('cpu')).toBe(path.join(root(), 'cpu', 'bin'));
  });

  it('finds the library nested under a subfolder, direct or in its bin', () => {
    const nested = path.join(root(), 'cuda', 'nemo-speech-0.3.0', 'bin');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, NEMO_RUNTIME_DLL), 'dll');
    expect(findLibraryDirectory(path.join(root(), 'cuda'))).toBe(nested);
    const flat = path.join(root(), 'cpu', 'x');
    fs.mkdirSync(flat, { recursive: true });
    fs.writeFileSync(path.join(flat, NEMO_RUNTIME_DLL), 'dll');
    expect(manager().isReady('cpu')).toBe(true);
  });

  it('binDirectory throws when the runtime is missing', () => {
    expect(() => manager().binDirectory('cuda')).toThrow(
      'The NeMo-Speech Cuda runtime is not installed.',
    );
  });

  it('IsReady_WhenAnInstallWasInterrupted_ReturnsFalse; another backend stays true', () => {
    putRuntime('cpu');
    putRuntime('cuda');
    fs.writeFileSync(path.join(root(), 'cuda.incomplete'), '');
    expect(manager().isReady('cuda')).toBe(false);
    expect(manager().isReady('cpu')).toBe(true);
  });

  describe('installExtracted', () => {
    const extracted = (): string => {
      const tree = path.join(root(), 'cpu.extracting');
      fs.mkdirSync(path.join(tree, 'pkg', 'bin'), { recursive: true });
      fs.writeFileSync(path.join(tree, 'pkg', 'bin', NEMO_RUNTIME_DLL), 'dll');
      return tree;
    };

    it('InstallExtracted_WhenTheCopyFallbackSucceeds_ReportsReady (move fails 8 times with backoff)', async () => {
      const sleeps: number[] = [];
      const m = manager({
        moveDirectory: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EPERM' })),
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      });
      await m.installExtracted('cpu', extracted());
      expect(sleeps).toEqual([150, 300, 450, 600, 750, 900, 1050, 1200]);
      expect(m.isReady('cpu')).toBe(true);
      expect(fs.existsSync(path.join(root(), 'cpu.incomplete'))).toBe(false);
      expect(fs.existsSync(path.join(root(), 'cpu.extracting'))).toBe(false);
    });

    it('InstallExtracted_WhenTheCopyFallbackFailsMidway_DoesNotReportReady', async () => {
      const m = manager({
        moveDirectory: () => Promise.reject(Object.assign(new Error('denied'), { code: 'EPERM' })),
        copyTree: (_from, to) => {
          fs.mkdirSync(path.join(to, 'pkg', 'bin'), { recursive: true });
          return Promise.reject(new Error('disk full'));
        },
      });
      await expect(m.installExtracted('cpu', extracted())).rejects.toThrow('disk full');
      expect(m.isReady('cpu')).toBe(false);
      expect(fs.existsSync(path.join(root(), 'cpu.incomplete'))).toBe(true);
      expect(fs.existsSync(path.join(root(), 'cpu'))).toBe(false);
    });

    it('InstallExtracted_OverAnInterruptedInstall_ReportsReady', async () => {
      putRuntime('cpu');
      fs.writeFileSync(path.join(root(), 'cpu.incomplete'), '');
      const m = manager();
      await m.installExtracted('cpu', extracted());
      expect(m.isReady('cpu')).toBe(true);
    });

    it('InstallExtracted_WhenTheFolderHasNoNativeLibrary_ThrowsAndDoesNotReportReady', async () => {
      const tree = path.join(root(), 'cpu.extracting');
      fs.mkdirSync(path.join(tree, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(tree, 'bin', 'other.dll'), 'x');
      const m = manager();
      await expect(m.installExtracted('cpu', tree)).rejects.toThrow(
        `NeMo-Speech Cpu zip extracted but ${NEMO_RUNTIME_DLL} was not found.`,
      );
      expect(m.isReady('cpu')).toBe(false);
      expect(fs.existsSync(path.join(root(), 'cpu'))).toBe(false);
    });
  });

  describe('download', () => {
    const pins = (zipSha: string): Record<AsrBackend, PinnedRuntime> => ({
      cpu: { backend: 'cpu', folder: 'cpu', url: 'http://pinned/cpu.zip', sha256: zipSha },
      cuda: { backend: 'cuda', folder: 'cuda', url: 'http://pinned/cuda.zip', sha256: zipSha },
    });

    it('downloads, verifies, extracts, promotes and cleans up (real zip, real tar)', async () => {
      const src = path.join(dir, 'src', 'nemo-pkg', 'bin');
      fs.mkdirSync(src, { recursive: true });
      fs.writeFileSync(path.join(src, NEMO_RUNTIME_DLL), 'dll bytes');
      const zip = path.join(dir, 'made.zip');
      const { spawnSync } = await import('node:child_process');
      const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
      const made = spawnSync(
        process.platform === 'win32' ? tar : 'zip',
        process.platform === 'win32'
          ? ['-a', '-cf', zip, '-C', path.join(dir, 'src'), 'nemo-pkg']
          : ['-r', zip, 'nemo-pkg'],
        { cwd: dir },
      );
      expect(made.status).toBe(0);
      const zipBytes = fs.readFileSync(zip);
      const progress: number[] = [];
      const m = manager({
        runtimes: pins(sha(zipBytes)),
        download: (_url, target, onProgress) => {
          fs.writeFileSync(target, zipBytes);
          onProgress(100);
          return Promise.resolve();
        },
        extract: extractZipWithTar,
      });
      await m.download('cpu', (p) => progress.push(p));
      expect(m.isReady('cpu')).toBe(true);
      expect(progress).toEqual([100]);
      expect(fs.existsSync(path.join(root(), 'cpu.zip'))).toBe(false);
      expect(fs.existsSync(path.join(root(), 'cpu.extracting'))).toBe(false);
      expect(fs.existsSync(path.join(root(), 'cpu.incomplete'))).toBe(false);
    });

    it('a SHA-256 mismatch throws the exact message and removes the zip', async () => {
      const m = manager({
        runtimes: pins('b'.repeat(64)),
        download: (_url, target) => {
          fs.writeFileSync(target, 'not the pinned file');
          return Promise.resolve();
        },
      });
      const actual = sha('not the pinned file');
      await expect(m.download('cuda', () => undefined)).rejects.toThrow(
        `NeMo-Speech Cuda zip SHA-256 mismatch (expected ${'b'.repeat(64)}, got ${actual}).`,
      );
      expect(fs.existsSync(path.join(root(), 'cuda.zip'))).toBe(false);
      expect(m.isReady('cuda')).toBe(false);
    });

    it('B17: two callers share one download per backend', async () => {
      let calls = 0;
      const m = manager({
        runtimes: pins(sha('z')),
        download: async (_url, target) => {
          calls += 1;
          await new Promise((r) => setTimeout(r, 30));
          fs.writeFileSync(target, 'z');
        },
        extract: (_zip, to) => {
          fs.mkdirSync(path.join(to, 'bin'), { recursive: true });
          fs.writeFileSync(path.join(to, 'bin', NEMO_RUNTIME_DLL), 'd');
          return Promise.resolve();
        },
      });
      await Promise.all([m.download('cpu', () => undefined), m.download('cpu', () => undefined)]);
      expect(calls).toBe(1);
      expect(m.isReady('cpu')).toBe(true);
    });
  });

  describe('delete', () => {
    it('DeleteRuntime_RemovesExtractedFiles; WhenMissing_DoesNotThrow', async () => {
      const m = manager();
      await m.delete();
      putRuntime('cpu');
      putRuntime('cuda');
      await m.delete();
      expect(fs.existsSync(root())).toBe(false);
    });

    it('DeleteRuntime_WhenAFileIsHeldOpen_ThrowsAndRemovesNothing', async () => {
      putRuntime('cpu');
      putRuntime('cuda');
      const m = manager({
        probeFile: (file) => {
          if (file.includes(`${path.sep}cuda${path.sep}`)) {
            throw Object.assign(new Error('busy'), { code: 'EBUSY' });
          }
        },
      });
      await expect(m.delete()).rejects.toBeInstanceOf(RuntimeInUseError);
      expect(m.isReady('cpu')).toBe(true);
      expect(m.isReady('cuda')).toBe(true);
    });

    it('ignores a file that vanished while probing', async () => {
      putRuntime('cpu');
      const m = manager({
        probeFile: () => {
          throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        },
      });
      await m.delete();
      expect(fs.existsSync(root())).toBe(false);
    });

    it('DeleteRuntime_WhenDeletionFailsPartway_DoesNotReportReady, and a retry finishes the job', async () => {
      putRuntime('cpu');
      putRuntime('cuda');
      let fail = true;
      const m = manager({
        removeDirectory: async (target) => {
          if (fail && target.endsWith(`${path.sep}cuda`)) {
            fail = false;
            throw new Error('Defender holds it');
          }
          fs.rmSync(target, { recursive: true, force: true });
        },
      });
      await expect(m.delete()).rejects.toThrow('Defender holds it');
      expect(m.isReady('cuda')).toBe(false);
      expect(fs.existsSync(path.join(root(), 'cuda.incomplete'))).toBe(true);
      await m.delete();
      expect(fs.existsSync(root())).toBe(false);
    });
  });
});

describe('WavFrameReader', () => {
  it('reads PCM16 as floats with the real rate and duration', () => {
    const wav = path.join(dir, 'a.wav');
    writeWav(wav, { rate: 16_000, channels: 1, seconds: 1 });
    const source = new WavFrameReader().open(wav);
    expect(source.sampleRate).toBe(16_000);
    expect(source.channels).toBe(1);
    expect(source.durationMs).toBeCloseTo(1000, 0);
    const buffer = new Float32Array(1600);
    let total = 0;
    for (;;) {
      const n = source.read(buffer);
      if (n === 0) break;
      total += n;
    }
    expect(total).toBe(16_000);
    source.close();
    source.close();
  });

  it('reads stereo and float WAVs', () => {
    const wav = path.join(dir, 'b.wav');
    writeWav(wav, { rate: 48_000, channels: 2, float: true, bits: 32, seconds: 0.1 });
    const source = new WavFrameReader().open(wav);
    expect(source.channels).toBe(2);
    const buffer = new Float32Array(3200);
    expect(source.read(buffer)).toBe(3200);
    expect(Math.max(...buffer)).toBeGreaterThan(0.1);
    source.close();
  });

  it('TranscribeAsync_WavLeftOpenByAbruptExit_IsRepairedAndTranscribed: zero sizes are fixed first', () => {
    const wav = path.join(dir, 'c.wav');
    writeWav(wav, { rate: 16_000, channels: 1, seconds: 1 });
    const bytes = fs.readFileSync(wav);
    bytes.writeUInt32LE(0, 4);
    bytes.writeUInt32LE(0, 40);
    fs.writeFileSync(wav, bytes);
    const source = new WavFrameReader().open(wav);
    expect(source.durationMs).toBeCloseTo(1000, 0);
    source.close();
    expect(fs.readFileSync(wav).readUInt32LE(40)).toBe(32_000);
  });

  it('reads a 18 byte fmt chunk (SAPI) and rejects what is not a WAV', () => {
    const wav = path.join(dir, 'd.wav');
    const pcm = Buffer.alloc(3200);
    const head = Buffer.alloc(46);
    head.write('RIFF', 0);
    head.writeUInt32LE(38 + pcm.length, 4);
    head.write('WAVEfmt ', 8);
    head.writeUInt32LE(18, 16);
    head.writeUInt16LE(1, 20);
    head.writeUInt16LE(1, 22);
    head.writeUInt32LE(16_000, 24);
    head.writeUInt32LE(32_000, 28);
    head.writeUInt16LE(2, 32);
    head.writeUInt16LE(16, 34);
    head.writeUInt16LE(0, 36);
    head.write('data', 38);
    head.writeUInt32LE(pcm.length, 42);
    fs.writeFileSync(wav, Buffer.concat([head, pcm]));
    const source = new WavFrameReader().open(wav);
    expect(source.durationMs).toBeCloseTo(100, 0);
    source.close();
    const bad = path.join(dir, 'e.wav');
    fs.writeFileSync(bad, 'this is not a wav file at all');
    expect(() => new WavFrameReader().open(bad)).toThrow(/not a WAV/);
  });
});
