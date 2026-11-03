import { CancelSource } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { convertForImport, type ImportConversionDeps } from './import-run';

const WAV = 'C:/Inbox/2026-11-03 Call.wav';

function build(over: Partial<ImportConversionDeps> = {}) {
  const removed: string[] = [];
  const deps: ImportConversionDeps = {
    convert: vi.fn(() => Promise.resolve()),
    cancelConversion: vi.fn(),
    allocate: vi.fn(() => WAV),
    wavDurationSeconds: () => 90,
    remove: (file) => {
      removed.push(file);
    },
    nowMs: () => 5_000_000,
    ...over,
  };
  return { deps, removed };
}
const request = { source: 'C:/in/call.mp3', title: 'Call', fileTimeMs: 10_000_000 };

describe('convertForImport', () => {
  it('B-19: the file time is the end and the start is derived from the duration (169)', async () => {
    const { deps } = build();
    const result = await convertForImport(deps, request, new CancelSource());
    expect(result).toEqual({
      ok: true,
      path: WAV,
      recordedAtMs: 10_000_000 - 90_000,
      endedAtMs: 10_000_000,
    });
  });

  it('allocates at the file time, and at now when the file time is unreadable (170)', async () => {
    const { deps } = build();
    await convertForImport(deps, { ...request, fileTimeMs: null }, new CancelSource());
    expect(deps.allocate).toHaveBeenCalledWith('Call', 5_000_000);
  });

  it('removes the partial WAV and reports Error_ImportAudio on a conversion failure (171)', async () => {
    const { deps, removed } = build({ convert: () => Promise.reject(new Error('bad codec')) });
    const result = await convertForImport(deps, request, new CancelSource());
    expect(result).toEqual({
      ok: false,
      cancelled: false,
      message: { key: 'Error_ImportAudio', args: ['bad codec'] },
    });
    expect(removed).toEqual([WAV]);
  });

  it('reports a failed allocation as the same error and removes nothing', async () => {
    const { deps, removed } = build({ allocate: () => Promise.reject(new Error('disk')) });
    const result = await convertForImport(deps, request, new CancelSource());
    expect(result).toMatchObject({ ok: false, message: { key: 'Error_ImportAudio' } });
    expect(removed).toEqual([]);
  });

  it('a cancel stops the conversion, removes the partial WAV and is not an error (170)', async () => {
    const cancel = new CancelSource();
    const { deps, removed } = build({
      convert: () => {
        cancel.cancel();
        return Promise.reject(new Error('aborted'));
      },
    });
    const result = await convertForImport(deps, request, cancel);
    expect(deps.cancelConversion).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, cancelled: true });
    expect(removed).toHaveLength(1);
  });

  it('a cancel that arrives as the conversion succeeds still removes the file', async () => {
    const cancel = new CancelSource();
    const { deps, removed } = build({
      convert: () => {
        cancel.cancel();
        return Promise.resolve();
      },
    });
    expect(await convertForImport(deps, request, cancel)).toMatchObject({ cancelled: true });
    expect(removed).toHaveLength(1);
  });
});
