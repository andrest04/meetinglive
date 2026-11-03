import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildWavHeader } from '@vozella/core';
import { recoverCrashedRecordings } from './recover-recordings';
import { readWavDurationSeconds } from './wav-files';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-recover-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const crashed = (bytes: number): Buffer =>
  Buffer.concat([buildWavHeader(0), Buffer.alloc(bytes, 7)]);

describe('recoverCrashedRecordings (C5)', () => {
  it('repairs a recording a crash left at zero sizes, so it can be opened again', async () => {
    fs.mkdirSync(path.join(dir, 'Folder', 'Sub'), { recursive: true });
    const file = path.join(dir, 'Folder', 'Sub', 'meeting.wav');
    fs.writeFileSync(file, crashed(64_000));
    expect(() => readWavDurationSeconds(file)).toThrow();
    const report = await recoverCrashedRecordings(dir);
    expect(report.repaired).toEqual([file]);
    expect(readWavDurationSeconds(file)).toBe(2);
  });

  it('leaves consistent files, other files and foreign WAVs alone', async () => {
    const good = path.join(dir, 'good.wav');
    fs.writeFileSync(good, Buffer.concat([buildWavHeader(3200), Buffer.alloc(3200)]));
    const note = path.join(dir, 'note.md');
    fs.writeFileSync(note, 'text');
    const foreign = path.join(dir, 'foreign.wav');
    fs.writeFileSync(foreign, 'not really a wav');
    const before = fs.statSync(good).mtimeMs;
    const report = await recoverCrashedRecordings(dir);
    expect(report).toEqual({ repaired: [], failed: [], scanned: 2 });
    expect(fs.statSync(good).mtimeMs).toBe(before);
    expect(fs.readFileSync(foreign, 'utf8')).toBe('not really a wav');
  });

  it('matches the extension without regard to case and survives a missing root', async () => {
    fs.writeFileSync(path.join(dir, 'LOUD.WAV'), crashed(3200));
    expect((await recoverCrashedRecordings(dir)).repaired).toHaveLength(1);
    expect(await recoverCrashedRecordings(path.join(dir, 'nope'))).toEqual({
      repaired: [],
      failed: [],
      scanned: 0,
    });
  });
});
