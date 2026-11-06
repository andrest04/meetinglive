/**
 * Document text extraction off the calling thread. pdfjs, mammoth and jszip parse synchronously in
 * the thread that calls them, so a large PDF on Electron's main thread froze every window. Each
 * document goes to its own short-lived worker thread instead; plain text is cheap and stays here.
 * The size and text limits are unchanged: the caller checks the bytes, the worker gets `maxChars`.
 */
import type { DocumentKind } from '@vozella/core';
import { extractDocument, type ExtractResult } from './attachment-extractors';

/** How the attachment store extracts one document. `extractDocument` itself fits. */
export type DocumentExtractor = (
  kind: DocumentKind,
  data: Uint8Array,
  maxChars: number,
) => Promise<ExtractResult>;

/** What the worker receives: one document. */
export interface ExtractRequest {
  readonly kind: DocumentKind;
  readonly data: Uint8Array;
  readonly maxChars: number;
}

/** The part of `worker_threads.Worker` the extractor uses, so tests can stand in for it. */
export interface ExtractWorker {
  postMessage(message: ExtractRequest, transfer: readonly ArrayBuffer[]): void;
  once(event: 'message', listener: (value: unknown) => void): unknown;
  once(event: 'error', listener: (error: unknown) => void): unknown;
  once(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

/** Two minutes: far beyond a 20 MB PDF, short enough that a stuck parser cannot pin a chip. */
export const EXTRACT_TIMEOUT_MS = 2 * 60 * 1000;

const UNREADABLE: ExtractResult = { ok: false, reason: 'unreadable' };

/**
 * A `DocumentExtractor` that parses PDF, Word and PowerPoint in a fresh worker per document and
 * ends it after the answer. A worker that fails, exits, cannot start or runs past the timeout
 * leaves the file unreadable; it never throws.
 */
export function createThreadedDocumentExtractor(
  spawn: () => ExtractWorker,
  options: { readonly timeoutMs?: number } = {},
): DocumentExtractor {
  const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS;
  return async (kind, data, maxChars) => {
    if (kind === 'text') return extractDocument(kind, data, maxChars);
    let worker: ExtractWorker;
    try {
      worker = spawn();
    } catch {
      return UNREADABLE;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<ExtractResult>((resolve) => {
        worker.once('message', (value) => {
          resolve(value as ExtractResult);
        });
        worker.once('error', () => {
          resolve(UNREADABLE);
        });
        worker.once('exit', () => {
          resolve(UNREADABLE);
        });
        timer = setTimeout(() => {
          resolve(UNREADABLE);
        }, timeoutMs);
        // A copy moves to the worker; the caller keeps its own bytes.
        const copy = new Uint8Array(data);
        worker.postMessage({ kind, data: copy, maxChars }, [copy.buffer]);
      });
    } finally {
      clearTimeout(timer);
      await worker.terminate().catch(() => undefined);
    }
  };
}

/** The port a worker thread listens on (`worker_threads.parentPort`). */
export interface ExtractPort {
  on(event: 'message', listener: (request: ExtractRequest) => void): unknown;
  postMessage(value: ExtractResult): void;
}

/** The worker side: each request is answered with `extractDocument` on its bytes. */
export function serveDocumentExtraction(port: ExtractPort): void {
  port.on('message', (request) => {
    void extractDocument(request.kind, request.data, request.maxChars).then(
      (result) => {
        port.postMessage(result);
      },
      () => {
        port.postMessage(UNREADABLE);
      },
    );
  });
}
