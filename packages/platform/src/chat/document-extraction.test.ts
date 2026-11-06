import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { buildPdf } from './attachment-fixtures';
import { extractDocument, type ExtractResult } from './attachment-extractors';
import {
  createThreadedDocumentExtractor,
  serveDocumentExtraction,
  type ExtractRequest,
  type ExtractWorker,
} from './document-extraction';

/** A worker double: records what it was sent and answers with the scripted outcome. */
class FakeWorker extends EventEmitter implements ExtractWorker {
  readonly sent: { message: ExtractRequest; transfer: readonly unknown[] }[] = [];
  terminated = 0;

  constructor(private readonly answer: (request: ExtractRequest, worker: FakeWorker) => void) {
    super();
  }

  postMessage(message: ExtractRequest, transfer: readonly ArrayBuffer[]): void {
    this.sent.push({ message, transfer });
    queueMicrotask(() => {
      this.answer(message, this);
    });
  }

  terminate(): Promise<number> {
    this.terminated += 1;
    return Promise.resolve(0);
  }
}

const OK: ExtractResult = {
  ok: true,
  pages: 2,
  truncated: false,
  sections: [{ location: { kind: 'page', n: 1 }, text: 'Budget' }],
};

describe('createThreadedDocumentExtractor', () => {
  it('extracts a PDF in a worker and ends the worker after the answer', async () => {
    const workers: FakeWorker[] = [];
    const extract = createThreadedDocumentExtractor(() => {
      const worker = new FakeWorker((_, w) => w.emit('message', OK));
      workers.push(worker);
      return worker;
    });
    const data = new Uint8Array([1, 2, 3]);
    expect(await extract('pdf', data, 500)).toEqual(OK);
    expect(workers).toHaveLength(1);
    const sent = workers[0]?.sent[0];
    expect(sent?.message.kind).toBe('pdf');
    expect(sent?.message.maxChars).toBe(500);
    expect([...(sent?.message.data ?? [])]).toEqual([1, 2, 3]);
    // The bytes are moved to the worker, not copied by structured clone.
    expect(sent?.transfer).toEqual([sent?.message.data.buffer]);
    // The caller's buffer stays usable: the worker gets a copy.
    expect([...data]).toEqual([1, 2, 3]);
    expect(workers[0]?.terminated).toBe(1);
  });

  it('runs Word and PowerPoint in the worker too', async () => {
    let spawned = 0;
    const extract = createThreadedDocumentExtractor(() => {
      spawned += 1;
      return new FakeWorker((_, w) => w.emit('message', OK));
    });
    await extract('docx', new Uint8Array([1]), 10);
    await extract('pptx', new Uint8Array([1]), 10);
    expect(spawned).toBe(2);
  });

  it('decodes plain text in place, with no worker', async () => {
    let spawned = 0;
    const extract = createThreadedDocumentExtractor(() => {
      spawned += 1;
      return new FakeWorker(() => undefined);
    });
    const result = await extract('text', new TextEncoder().encode('hello'), 100);
    expect(result).toEqual({
      ok: true,
      pages: null,
      truncated: false,
      sections: [{ location: null, text: 'hello' }],
    });
    expect(spawned).toBe(0);
  });

  it('a worker that fails, exits early or cannot start leaves the file unreadable', async () => {
    const failing = createThreadedDocumentExtractor(
      () => new FakeWorker((_, w) => w.emit('error', new Error('boom'))),
    );
    expect(await failing('pdf', new Uint8Array([1]), 10)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    const exiting = createThreadedDocumentExtractor(
      () => new FakeWorker((_, w) => w.emit('exit', 1)),
    );
    expect(await exiting('pdf', new Uint8Array([1]), 10)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    const unstartable = createThreadedDocumentExtractor(() => {
      throw new Error('no worker file');
    });
    expect(await unstartable('pdf', new Uint8Array([1]), 10)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });

  it('a worker that never answers is ended at the timeout', async () => {
    const worker = new FakeWorker(() => undefined);
    const extract = createThreadedDocumentExtractor(() => worker, { timeoutMs: 20 });
    expect(await extract('pdf', new Uint8Array([1]), 10)).toEqual({
      ok: false,
      reason: 'unreadable',
    });
    expect(worker.terminated).toBe(1);
  });
});

describe('serveDocumentExtraction', () => {
  it('answers a request with what extractDocument gives on the same bytes', async () => {
    const port = new EventEmitter() as EventEmitter & { postMessage: (value: unknown) => void };
    const answers: unknown[] = [];
    const answered = new Promise<void>((resolve) => {
      port.postMessage = (value) => {
        answers.push(value);
        resolve();
      };
    });
    serveDocumentExtraction(port);
    const pdf = buildPdf(['Quarterly budget', 'Hiring plan']);
    port.emit('message', { kind: 'pdf', data: new Uint8Array(pdf), maxChars: 1000 });
    await answered;
    expect(answers).toEqual([await extractDocument('pdf', new Uint8Array(pdf), 1000)]);
    expect(answers[0]).toMatchObject({ ok: true, pages: 2 });
  });
});
