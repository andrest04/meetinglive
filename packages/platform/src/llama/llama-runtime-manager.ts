import fs from 'node:fs';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import { RuntimeInUseError, type CancelSignal, type LlamaBackend } from '@vozella/core';
import { downloadToFile } from '../settings/download-to-file';
import { extractZipWithTar, type ZipExtractor } from '../transcription/zip-extractor';
import {
  LLAMA_RELEASE_BASE_URL,
  LLAMA_RUNTIMES,
  LLAMA_SERVER_EXE,
  type LlamaRuntimePin,
} from './llama-runtime-catalog';

export interface LlamaRuntimeManagerOptions {
  /** `LlamaRuntime` folder under the app data root. */
  readonly root: string;
  readonly runtimes?: Readonly<Record<LlamaBackend, LlamaRuntimePin>>;
  /** Where the archives are served from. Tests point it at a local server. */
  readonly baseUrl?: string;
  readonly extract?: ZipExtractor;
  /** Opens a file for read and write with no sharing; throws when another holder has it. */
  readonly probeFile?: (file: string) => void;
  readonly stallTimeoutMs?: number;
}

export type LlamaProgressSink = (percent: number) => void;

const STALL_TIMEOUT_MS = 60_000;

function defaultProbe(file: string): void {
  fs.closeSync(fs.openSync(file, 'r+'));
}

/**
 * The extracted llama.cpp builds on disk: `<root>/<backend>` folders, a sibling
 * `<backend>.incomplete` marker while a folder is being promoted or removed, one install per
 * backend at a time, and a delete that refuses while a file of the build is held open.
 */
export class LlamaRuntimeManager {
  private readonly pins: Readonly<Record<LlamaBackend, LlamaRuntimePin>>;
  private readonly inFlight = new Map<LlamaBackend, Promise<string>>();

  constructor(private readonly options: LlamaRuntimeManagerOptions) {
    this.pins = options.runtimes ?? LLAMA_RUNTIMES;
  }

  private folderOf(backend: LlamaBackend): string {
    return nodePath.join(this.options.root, this.pins[backend].folder);
  }

  private markerOf(backend: LlamaBackend): string {
    return `${this.folderOf(backend)}.incomplete`;
  }

  /** Marker absent and `llama-server.exe` found in the folder. */
  isReady(backend: LlamaBackend): boolean {
    if (fs.existsSync(this.markerOf(backend))) return false;
    return findServerDirectory(this.folderOf(backend)) !== null;
  }

  /** The folder that holds `llama-server.exe` and the DLLs next to it (the process cwd). */
  binDirectory(backend: LlamaBackend): string {
    const found = this.isReady(backend) ? findServerDirectory(this.folderOf(backend)) : null;
    if (found === null) throw new Error(`The ${backend} llama.cpp runtime is not installed.`);
    return found;
  }

  serverPath(backend: LlamaBackend): string {
    return nodePath.join(this.binDirectory(backend), LLAMA_SERVER_EXE);
  }

  /**
   * Installs the backend when it is not ready and returns the server path. A second caller for
   * the same backend shares the first install. The percent covers all archives of the backend.
   */
  ensure(
    backend: LlamaBackend,
    onProgress: LlamaProgressSink = () => undefined,
    cancel?: CancelSignal,
  ): Promise<string> {
    const running = this.inFlight.get(backend);
    if (running) return running;
    if (this.isReady(backend)) return Promise.resolve(this.serverPath(backend));
    const work = this.install(backend, onProgress, cancel).finally(() => {
      this.inFlight.delete(backend);
    });
    this.inFlight.set(backend, work);
    return work;
  }

  private async install(
    backend: LlamaBackend,
    onProgress: LlamaProgressSink,
    cancel?: CancelSignal,
  ): Promise<string> {
    const pin = this.pins[backend];
    const { root } = this.options;
    await fsp.mkdir(root, { recursive: true });
    const base = this.options.baseUrl ?? LLAMA_RELEASE_BASE_URL;
    const extracting = `${this.folderOf(backend)}.extracting`;
    const zips: string[] = [];
    try {
      await fsp.rm(extracting, { recursive: true, force: true });
      const share = 100 / pin.archives.length;
      for (const [index, archive] of pin.archives.entries()) {
        const zip = nodePath.join(root, archive.name);
        zips.push(zip);
        await downloadToFile({
          url: `${base}/${archive.name}`,
          target: zip,
          sha256: archive.sha256,
          resume: true,
          stallTimeoutMs: this.options.stallTimeoutMs ?? STALL_TIMEOUT_MS,
          onProgress: (percent) => {
            onProgress(Math.min(99, Math.floor(index * share + (percent * share) / 100)));
          },
          ...(cancel ? { cancel } : {}),
        });
        if (cancel?.cancelled) throw new Error('The download was cancelled.');
        await (this.options.extract ?? extractZipWithTar)(zip, extracting);
      }
      await this.promote(backend, extracting);
      onProgress(100);
      return this.serverPath(backend);
    } catch (error) {
      await fsp.rm(extracting, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await Promise.all(zips.map((z) => fsp.rm(z, { force: true }).catch(() => undefined)));
    }
  }

  /** The marker covers the whole promote; a failure removes the destination and keeps the marker. */
  private async promote(backend: LlamaBackend, extracted: string): Promise<void> {
    const destination = this.folderOf(backend);
    const marker = this.markerOf(backend);
    await fsp.writeFile(marker, '');
    try {
      await fsp.rm(destination, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      await fsp.rename(extracted, destination);
      if (findServerDirectory(destination) === null) {
        throw new Error(
          `The ${backend} archive was extracted but ${LLAMA_SERVER_EXE} was not found.`,
        );
      }
      await fsp.rm(marker, { force: true });
    } catch (error) {
      await fsp.rm(destination, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Removes one backend. Every file is probed first; one that cannot be opened means the server
   * is running, and nothing is removed.
   */
  async delete(backend: LlamaBackend): Promise<void> {
    const folder = this.folderOf(backend);
    const marker = this.markerOf(backend);
    if (!fs.existsSync(folder)) {
      await fsp.rm(marker, { force: true });
      return;
    }
    const probe = this.options.probeFile ?? defaultProbe;
    for (const file of listFiles(folder)) {
      try {
        probe(file);
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') continue;
        throw new RuntimeInUseError(nodePath.basename(file));
      }
    }
    await fsp.writeFile(marker, '');
    await fsp.rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    await fsp.rm(marker, { force: true });
  }
}

/** The folder itself, or one subfolder (some archives wrap their files in a directory). */
export function findServerDirectory(folder: string): string | null {
  if (fs.existsSync(nodePath.join(folder, LLAMA_SERVER_EXE))) return folder;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = nodePath.join(folder, entry.name);
    if (fs.existsSync(nodePath.join(dir, LLAMA_SERVER_EXE))) return dir;
  }
  return null;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = nodePath.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}
