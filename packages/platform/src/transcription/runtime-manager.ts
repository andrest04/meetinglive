import fs from 'node:fs';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import {
  NEMO_RUNTIME_DLL,
  NEMO_RUNTIMES,
  RuntimeInUseError,
  type AsrBackend,
  type CancelSignal,
  type PinnedRuntime,
  type RuntimeStore,
} from '@vozella/core';
import { downloadToFile, sha256OfFile } from '../settings/download-to-file';
import { extractZipWithTar, type ZipExtractor } from './zip-extractor';

/** The seams a test needs: the network, the archive, the clock and the two ways to move a tree. */
export interface RuntimeManagerOptions {
  /** `NemoSpeech` folder under the app data root. */
  readonly root: string;
  readonly runtimes?: Readonly<Record<AsrBackend, PinnedRuntime>>;
  readonly download?: (
    url: string,
    target: string,
    onProgress: (percent: number) => void,
    cancel?: CancelSignal,
  ) => Promise<void>;
  readonly extract?: ZipExtractor;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Moves a directory. Defaults to rename. */
  readonly moveDirectory?: (from: string, to: string) => Promise<void>;
  /** Copies a tree recursively. Defaults to `fs.cp`. */
  readonly copyTree?: (from: string, to: string) => Promise<void>;
  /** Opens a file for read and write with no sharing; throws when another holder has it. */
  readonly probeFile?: (file: string) => void;
  /** Recursively removes a directory. */
  readonly removeDirectory?: (dir: string) => Promise<void>;
}

const PROMOTE_ATTEMPTS = 8;
const STALL_TIMEOUT_MS = 60_000;
const backendLabel = (backend: AsrBackend): string => (backend === 'cuda' ? 'Cuda' : 'Cpu');

function defaultProbe(file: string): void {
  const handle = fs.openSync(file, 'r+');
  fs.closeSync(handle);
}

/**
 * The extracted NeMo-Speech runtimes on disk (spec 3.8): `cpu` and `cuda` folders, a negative
 * `.incomplete` marker while a folder is being promoted or removed, and a delete that refuses
 * while a file is held open.
 */
export class NemoSpeechRuntimeManager implements RuntimeStore {
  private readonly pins: Readonly<Record<AsrBackend, PinnedRuntime>>;
  private readonly inFlight = new Map<AsrBackend, Promise<void>>();

  constructor(private readonly options: RuntimeManagerOptions) {
    this.pins = options.runtimes ?? NEMO_RUNTIMES;
  }

  private folderOf(backend: AsrBackend): string {
    return nodePath.join(this.options.root, this.pins[backend].folder);
  }

  private markerOf(backend: AsrBackend): string {
    return `${this.folderOf(backend)}.incomplete`;
  }

  /** Marker absent and the library found under the folder. Older complete installs have no marker. */
  isReady(backend: AsrBackend): boolean {
    if (fs.existsSync(this.markerOf(backend))) return false;
    return findLibraryDirectory(this.folderOf(backend)) !== null;
  }

  binDirectory(backend: AsrBackend): string {
    const found = this.isReady(backend) ? findLibraryDirectory(this.folderOf(backend)) : null;
    if (found === null) {
      throw new Error(`The NeMo-Speech ${backendLabel(backend)} runtime is not installed.`);
    }
    return found;
  }

  /** One download per backend at a time; a second caller shares the first (B17). */
  download(
    backend: AsrBackend,
    onProgress: (percent: number) => void,
    cancel?: CancelSignal,
  ): Promise<void> {
    const running = this.inFlight.get(backend);
    if (running) return running;
    const work = this.downloadNow(backend, onProgress, cancel).finally(() => {
      this.inFlight.delete(backend);
    });
    this.inFlight.set(backend, work);
    return work;
  }

  private async downloadNow(
    backend: AsrBackend,
    onProgress: (percent: number) => void,
    cancel?: CancelSignal,
  ): Promise<void> {
    const pin = this.pins[backend];
    const { root } = this.options;
    await fsp.mkdir(root, { recursive: true });
    const zip = `${this.folderOf(backend)}.zip`;
    const extracting = `${this.folderOf(backend)}.extracting`;
    const download =
      this.options.download ??
      ((url, target, progress, signal) =>
        downloadToFile({
          url,
          target,
          onProgress: progress,
          stallTimeoutMs: STALL_TIMEOUT_MS,
          ...(signal ? { cancel: signal } : {}),
        }));
    try {
      await download(pin.url, zip, onProgress, cancel);
      const actual = await sha256OfFile(zip);
      if (actual.toLowerCase() !== pin.sha256.toLowerCase()) {
        throw new Error(
          `NeMo-Speech ${backendLabel(backend)} zip SHA-256 mismatch (expected ${pin.sha256}, got ${actual}).`,
        );
      }
      await fsp.rm(extracting, { recursive: true, force: true });
      await (this.options.extract ?? extractZipWithTar)(zip, extracting);
      await this.installExtracted(backend, extracting);
    } catch (error) {
      await fsp.rm(extracting, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    } finally {
      await fsp.rm(zip, { force: true }).catch(() => undefined);
    }
  }

  /**
   * Promotes the extracted tree to the runtime folder. The marker covers the whole promote; a
   * failure removes the destination and leaves the marker, so the runtime reports not ready.
   */
  async installExtracted(backend: AsrBackend, extractedDir: string): Promise<void> {
    const destination = this.folderOf(backend);
    const marker = this.markerOf(backend);
    await fsp.writeFile(marker, '');
    try {
      await this.promote(extractedDir, destination);
      if (findLibraryDirectory(destination) === null) {
        throw new Error(
          `NeMo-Speech ${backendLabel(backend)} zip extracted but ${NEMO_RUNTIME_DLL} was not found.`,
        );
      }
      await fsp.rm(marker, { force: true });
    } catch (error) {
      await this.removeTree(destination).catch(() => undefined);
      throw error;
    }
  }

  /** Up to 8 tries of delete then move (Defender scans cause Access denied), then copy. */
  private async promote(from: string, to: string): Promise<void> {
    const move = this.options.moveDirectory ?? ((a, b) => fsp.rename(a, b));
    const sleep = this.options.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let attempt = 0; attempt < PROMOTE_ATTEMPTS; attempt += 1) {
      try {
        await this.removeTree(to);
        await move(from, to);
        return;
      } catch (error) {
        if (!isRetryable(error)) throw error;
        await sleep(150 * (attempt + 1));
      }
    }
    await this.removeTree(to);
    await (this.options.copyTree ?? ((a, b) => fsp.cp(a, b, { recursive: true })))(from, to);
    await this.removeTree(from);
  }

  private removeTree(dir: string): Promise<void> {
    return (
      this.options.removeDirectory ??
      ((target) => fsp.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }))
    )(dir);
  }

  /**
   * Removes both runtimes. Every file is probed first; one that cannot be opened means the
   * library is loaded, and nothing is removed. A failure partway leaves that backend's marker.
   */
  async delete(): Promise<void> {
    const { root } = this.options;
    if (!fs.existsSync(root)) return;
    const probe = this.options.probeFile ?? defaultProbe;
    for (const file of listFiles(root)) {
      try {
        probe(file);
      } catch (error) {
        if ((error as { code?: unknown }).code === 'ENOENT') continue;
        throw new RuntimeInUseError(nodePath.basename(file));
      }
    }
    for (const backend of ['cpu', 'cuda'] as const) {
      const folder = this.folderOf(backend);
      if (!fs.existsSync(folder)) continue;
      const marker = this.markerOf(backend);
      await fsp.writeFile(marker, '');
      await this.removeTree(folder);
      await fsp.rm(marker, { force: true });
    }
    await this.removeTree(root);
  }
}

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === undefined || ['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EXDEV'].includes(code);
}

/** Direct `bin`, then any subfolder: `<dir>\dll` or `<dir>\bin\dll`. */
export function findLibraryDirectory(folder: string): string | null {
  if (!fs.existsSync(folder)) return null;
  const direct = nodePath.join(folder, 'bin');
  if (fs.existsSync(nodePath.join(direct, NEMO_RUNTIME_DLL))) return direct;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(folder, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = nodePath.join(folder, entry.name);
    if (fs.existsSync(nodePath.join(dir, NEMO_RUNTIME_DLL))) return dir;
    const nested = nodePath.join(dir, 'bin');
    if (fs.existsSync(nodePath.join(nested, NEMO_RUNTIME_DLL))) return nested;
    const deeper = findLibraryDirectory(dir);
    if (deeper !== null) return deeper;
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
