import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import type { CancelSignal } from '@vozella/core';

export interface DownloadOptions {
  readonly url: string;
  readonly target: string;
  /** Percent 0 to 100, whenever the whole number changes. Only when the server declares a length. */
  readonly onProgress?: (percent: number) => void;
  readonly cancel?: CancelSignal;
  /** Tests replace it; production uses the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** The size the finished file must have. A different size removes the file (B18). */
  readonly expectedBytes?: number;
  /** Lowercase hex SHA-256 the finished file must have. A mismatch removes the file. */
  readonly sha256?: string;
  /**
   * Keeps the `.part` file after a failure and continues it with a Range request next time (B5).
   * A cancel, a checksum mismatch or an HTTP error still removes it.
   */
  readonly resume?: boolean;
  /** Aborts when no byte arrives for this long (B5). Off by default. */
  readonly stallTimeoutMs?: number;
}

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function moveIntoPlace(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (attempt >= 5 || typeof code !== 'string' || !RETRYABLE.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

/** SHA-256 of a file as lowercase hex, streamed so a 500 MB runtime is not held in memory. */
export function sha256OfFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`The download failed: HTTP ${String(status)}`);
    this.name = 'HttpStatusError';
  }
}

class ChecksumError extends Error {}

/**
 * Downloads `url` into `<target>.part` and moves it to `target` only when the transfer is
 * complete, so a failed or cancelled download never leaves a file that looks finished. The
 * `.part` file is removed on every failure unless `resume` keeps it. Rejects with the HTTP status
 * for a non 2xx answer.
 */
export async function downloadToFile(options: DownloadOptions): Promise<void> {
  const part = `${options.target}.part`;
  try {
    await attempt(options, part, true);
  } catch (error) {
    const keep =
      options.resume === true &&
      !(options.cancel?.cancelled ?? false) &&
      !(error instanceof ChecksumError) &&
      !(error instanceof HttpStatusError);
    if (!keep && fs.existsSync(part)) await fsp.rm(part, { force: true }).catch(() => undefined);
    if (options.cancel?.cancelled) throw new Error('The download was cancelled.', { cause: error });
    throw error;
  }
}

async function attempt(options: DownloadOptions, part: string, mayRetry: boolean): Promise<void> {
  const { url, target, onProgress, cancel } = options;
  const controller = new AbortController();
  const stopCancel = cancel?.onCancel(() => {
    controller.abort();
  });
  const state = { stalled: false };
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const armStall = (): void => {
    if (options.stallTimeoutMs === undefined) return;
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      state.stalled = true;
      controller.abort();
    }, options.stallTimeoutMs);
  };
  let handle: fsp.FileHandle | undefined;
  try {
    await fsp.mkdir(nodePath.dirname(target), { recursive: true });
    let existing = 0;
    if (options.resume === true) {
      existing = await fsp.stat(part).then(
        (s) => s.size,
        () => 0,
      );
    }
    armStall();
    const response = await (options.fetch ?? fetch)(url, {
      signal: controller.signal,
      redirect: 'follow',
      ...(existing > 0 ? { headers: { Range: `bytes=${String(existing)}-` } } : {}),
    });
    if (response.status === 416 && existing > 0 && mayRetry) {
      // The server does not accept the offset: start again from the beginning.
      await fsp.rm(part, { force: true });
      await response.body?.cancel().catch(() => undefined);
      clearTimeout(stallTimer);
      stopCancel?.();
      await attempt(options, part, false);
      return;
    }
    if (!response.ok) throw new HttpStatusError(response.status);
    if (!response.body) throw new Error('The download failed: the server sent no data.');

    const resumed = existing > 0 && response.status === 206;
    const declared = Number(response.headers.get('content-length'));
    const bodyLength = Number.isFinite(declared) && declared > 0 ? declared : null;
    const total = bodyLength === null ? null : bodyLength + (resumed ? existing : 0);
    handle = await fsp.open(part, resumed ? 'a' : 'w');
    let received = resumed ? existing : 0;
    let lastPercent = -1;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      armStall();
      await handle.write(chunk);
      received += chunk.byteLength;
      if (total !== null) {
        const percent = Math.min(100, Math.floor((received * 100) / total));
        if (percent !== lastPercent) {
          lastPercent = percent;
          onProgress?.(percent);
        }
      }
    }
    if (total !== null && received < total) {
      throw new Error(`The download ended early: ${String(received)} of ${String(total)} bytes.`);
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (options.expectedBytes !== undefined) {
      const actualBytes = (await fsp.stat(part)).size;
      if (actualBytes !== options.expectedBytes) {
        throw new ChecksumError(
          `The download is damaged: expected ${String(options.expectedBytes)} bytes, got ${String(actualBytes)}.`,
        );
      }
    }
    if (options.sha256 !== undefined) {
      const actual = await sha256OfFile(part);
      if (actual !== options.sha256.toLowerCase()) {
        throw new ChecksumError(
          `The download is damaged: SHA-256 mismatch (expected ${options.sha256}, got ${actual}).`,
        );
      }
    }
    await moveIntoPlace(part, target);
  } catch (error) {
    if (state.stalled) throw new Error('The download stalled: no data arrived.', { cause: error });
    throw error;
  } finally {
    clearTimeout(stallTimer);
    stopCancel?.();
    await handle?.close().catch(() => undefined);
  }
}
