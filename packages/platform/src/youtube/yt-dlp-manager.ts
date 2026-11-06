import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import { CancelledError, type CancelSignal, type Logger } from '@vozella/core';
import { downloadToFile, sha256OfFile } from '../settings/download-to-file';
import { killProcessTree } from '../summaries/cli-process-runner';

export const YT_DLP_RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
export const YT_DLP_EXE = 'yt-dlp.exe';
const SUMS_FILE = 'SHA2-256SUMS';
const STALL_TIMEOUT_MS = 60_000;
const SELF_UPDATE_TIMEOUT_MS = 120_000;

export type YtDlpInstallFailure = 'download-failed' | 'checksum-missing' | 'checksum-mismatch';

/** yt-dlp could not be installed. `reason` is stable so the UI can pick a localized message. */
export class YtDlpInstallError extends Error {
  constructor(
    readonly reason: YtDlpInstallFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'YtDlpInstallError';
  }
}

export interface YtDlpManagerOptions {
  /** Folder under app data that holds `yt-dlp.exe`. Created on first download. */
  readonly binDir: string;
  /** Tests replace it; production uses the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Runs `yt-dlp.exe -U`. Defaults to a hidden child process with a two minute limit. */
  readonly runSelfUpdate?: (exe: string) => Promise<void>;
  readonly logger?: Logger;
  readonly releaseUrl?: string;
}

/** The hash on the `yt-dlp.exe` line of a `sha256sum` listing, lowercase, or null. */
export function findYtDlpChecksum(sums: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line);
    if (match?.[2] === YT_DLP_EXE) return (match[1] ?? '').toLowerCase();
  }
  return null;
}

function runSelfUpdateProcess(exe: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-U'], { shell: false, windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => {
      void killProcessTree(child.pid);
      reject(new Error('yt-dlp -U did not finish in time.'));
    }, SELF_UPDATE_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp -U exited with code ${String(code)}.`));
    });
  });
}

/**
 * Keeps `yt-dlp.exe` in an app data folder. It is not bundled: the first use downloads the latest
 * release, checked against the release's `SHA2-256SUMS`, and `update()` runs `yt-dlp -U` once per
 * session because YouTube changes often break older versions.
 */
export class YtDlpManager {
  private inFlight: Promise<string> | null = null;
  private updateRun: Promise<void> | null = null;
  private installedThisSession = false;

  constructor(private readonly options: YtDlpManagerOptions) {}

  get executablePath(): string {
    return nodePath.join(this.options.binDir, YT_DLP_EXE);
  }

  isInstalled(): boolean {
    return fs.existsSync(this.executablePath);
  }

  /**
   * Returns the executable path, downloading it first when missing. Concurrent callers share one
   * download (and the first caller's cancel signal). A failure is not cached: the next call retries.
   */
  ensure(cancel?: CancelSignal): Promise<string> {
    if (this.isInstalled()) return Promise.resolve(this.executablePath);
    if (this.inFlight) return this.inFlight;
    const work = this.install(cancel).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = work;
    return work;
  }

  /** Best effort `yt-dlp -U`, at most once per session. Never rejects; failures are logged. */
  update(): Promise<void> {
    this.updateRun ??= this.selfUpdate();
    return this.updateRun;
  }

  private async selfUpdate(): Promise<void> {
    try {
      const exe = await this.ensure();
      if (this.installedThisSession) return;
      await (this.options.runSelfUpdate ?? runSelfUpdateProcess)(exe);
      this.options.logger?.info('yt-dlp self-update finished');
    } catch (error) {
      this.options.logger?.warn('yt-dlp self-update failed', { error: String(error) });
    }
  }

  private async install(cancel?: CancelSignal): Promise<string> {
    const base = this.options.releaseUrl ?? YT_DLP_RELEASE_URL;
    const target = this.executablePath;
    const temp = `${target}.download`;
    try {
      const expected = findYtDlpChecksum(await this.fetchText(`${base}/${SUMS_FILE}`, cancel));
      if (expected === null) {
        throw new YtDlpInstallError(
          'checksum-missing',
          `${SUMS_FILE} has no entry for ${YT_DLP_EXE}.`,
        );
      }
      await downloadToFile({
        url: `${base}/${YT_DLP_EXE}`,
        target: temp,
        stallTimeoutMs: STALL_TIMEOUT_MS,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
        ...(cancel ? { cancel } : {}),
      });
      const actual = await sha256OfFile(temp);
      if (actual !== expected) {
        throw new YtDlpInstallError(
          'checksum-mismatch',
          `The downloaded ${YT_DLP_EXE} is damaged: SHA-256 ${actual}, expected ${expected}.`,
        );
      }
      await fsp.rename(temp, target);
      this.installedThisSession = true;
      return target;
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch(() => undefined);
      if (cancel?.cancelled) throw new CancelledError();
      if (error instanceof YtDlpInstallError) throw error;
      throw new YtDlpInstallError(
        'download-failed',
        `${YT_DLP_EXE} could not be downloaded: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private async fetchText(url: string, cancel?: CancelSignal): Promise<string> {
    const controller = new AbortController();
    const stop = cancel?.onCancel(() => controller.abort());
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)} for ${url}`);
      return await response.text();
    } finally {
      stop?.();
    }
  }
}
