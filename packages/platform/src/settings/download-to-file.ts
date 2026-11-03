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

/**
 * Downloads `url` into `<target>.part` and moves it to `target` only when the transfer is
 * complete, so a failed or cancelled download never leaves a file that looks finished. The
 * `.part` file is removed on every failure. Rejects with the HTTP status for a non 2xx answer.
 */
export async function downloadToFile(options: DownloadOptions): Promise<void> {
  const { url, target, onProgress, cancel } = options;
  const part = `${target}.part`;
  const controller = new AbortController();
  const stop = cancel?.onCancel(() => {
    controller.abort();
  });
  let handle: fsp.FileHandle | undefined;
  try {
    await fsp.mkdir(nodePath.dirname(target), { recursive: true });
    const response = await (options.fetch ?? fetch)(url, {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`The download failed: HTTP ${String(response.status)}`);
    if (!response.body) throw new Error('The download failed: the server sent no data.');

    const declared = Number(response.headers.get('content-length'));
    const total = Number.isFinite(declared) && declared > 0 ? declared : null;
    handle = await fsp.open(part, 'w');
    let received = 0;
    let lastPercent = -1;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
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
    await moveIntoPlace(part, target);
  } catch (error) {
    if (cancel?.cancelled) throw new Error('The download was cancelled.', { cause: error });
    throw error;
  } finally {
    stop?.();
    await handle?.close().catch(() => undefined);
    if (fs.existsSync(part)) await fsp.rm(part, { force: true }).catch(() => undefined);
  }
}
