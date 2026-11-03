import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MicrophoneChoiceDto } from '@vozella/contracts';
import type { Logger } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingTakes, type TakeController } from './recording-take';

const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const mic: MicrophoneChoiceDto = { kind: 'SystemDefault', deviceId: null };

class CodedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

let inbox: string;
let clock: number;
beforeEach(() => {
  inbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-take-')), 'Inbox');
  clock = new Date(2026, 4, 3, 10, 0, 0).getTime();
});
afterEach(() => {
  fs.rmSync(path.dirname(inbox), { recursive: true, force: true });
});

function setup(overrides: Partial<TakeController> = {}, duration = 12.5) {
  const controller = {
    startRecording: vi.fn((file: string, _mic: MicrophoneChoiceDto) => {
      fs.writeFileSync(file, 'wav');
      return Promise.resolve({} as never);
    }),
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    importAudio: vi.fn((_source: string, destination: string) => {
      fs.writeFileSync(destination, 'wav');
      return Promise.resolve();
    }),
    ...overrides,
  };
  const takes = new RecordingTakes({
    controller: controller as TakeController,
    inboxDirectory: () => inbox,
    nowMs: () => clock,
    wavDurationSeconds: () => duration,
    logger,
  });
  return { takes, controller };
}

describe('RecordingTakes', () => {
  it('names the file after the local date and the title, in the Inbox', async () => {
    const { takes, controller } = setup();
    const result = await takes.start('Weekly sync', mic);
    expect(result).toEqual({ started: true, recordedAtMs: clock });
    expect(controller.startRecording).toHaveBeenCalledWith(
      path.join(inbox, '2026-05-03 Weekly sync.wav'),
      mic,
    );
  });

  it('uses Meeting for a blank title and a number when the name is taken (the Markdown counts too)', async () => {
    const { takes, controller } = setup();
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, '2026-05-03 Meeting.md'), '');
    await takes.start('  ', mic);
    expect(controller.startRecording).toHaveBeenCalledWith(
      path.join(inbox, '2026-05-03 Meeting 2.wav'),
      mic,
    );
  });

  it('refuses a second start while a take is running', async () => {
    const { takes, controller } = setup();
    await takes.start('a', mic);
    const second = await takes.start('b', mic);
    expect(second).toMatchObject({ started: false });
    expect(controller.startRecording).toHaveBeenCalledOnce();
  });

  it('reports a failed start with the worker code and lets the next start work', async () => {
    const failing = vi
      .fn()
      .mockRejectedValueOnce(new CodedError('nope', 'process-loopback-unsupported'))
      .mockResolvedValue({});
    const { takes } = setup({ startRecording: failing });
    expect(await takes.start('a', mic)).toEqual({
      started: false,
      code: 'process-loopback-unsupported',
      message: 'nope',
    });
    expect(await takes.start('a', mic)).toMatchObject({ started: true });
  });

  it('adds up the paused time for the live transcript clock (item 34)', async () => {
    const { takes } = setup();
    await takes.start('a', mic);
    clock += 10_000;
    expect(await takes.pause()).toBe(true);
    clock += 4_000;
    expect(await takes.resume()).toBe(true);
    clock += 5_000;
    await takes.pause();
    clock += 1_000;
    const stopped = await takes.stop();
    expect(stopped).toMatchObject({ pausedSeconds: 5, error: null });
    expect(stopped.path).toContain('2026-05-03 a.wav');
  });

  it('ignores pause and resume in the wrong state', async () => {
    const { takes, controller } = setup();
    expect(await takes.pause()).toBe(false);
    await takes.start('a', mic);
    expect(await takes.resume()).toBe(false);
    await takes.pause();
    expect(await takes.pause()).toBe(false);
    expect(controller.pause).toHaveBeenCalledOnce();
  });

  it('returns the stop error and frees the page for the next take (item 49)', async () => {
    const { takes } = setup({ stop: vi.fn().mockRejectedValue(new Error('disk full')) });
    await takes.start('a', mic);
    const stopped = await takes.stop();
    expect(stopped.error).toBe('disk full');
    expect(stopped.path).toContain('2026-05-03 a.wav');
    expect(await takes.start('b', mic)).toMatchObject({ started: true });
  });

  it('stop with no take is empty', async () => {
    const { takes, controller } = setup();
    expect(await takes.stop()).toEqual({
      path: null,
      recordedAtMs: null,
      pausedSeconds: 0,
      error: null,
    });
    expect(controller.stop).not.toHaveBeenCalled();
  });

  describe('import', () => {
    it('converts the picked file and ends the take at recordedAt plus the audio length (item 149)', async () => {
      const { takes, controller } = setup({}, 90.25);
      takes.rememberPick({ path: 'C:\\in\\call.m4a', recordedAtMs: 1_000_000 });
      const result = await takes.importPicked('Call');
      const expected = path.join(inbox, `${datePart(1_000_000)} Call.wav`);
      expect(controller.importAudio).toHaveBeenCalledWith('C:\\in\\call.m4a', expected);
      expect(result).toEqual({
        imported: true,
        path: expected,
        recordedAtMs: 1_000_000,
        endedAtMs: 1_000_000 + 90_250,
        durationSeconds: 90.25,
      });
    });

    it('deletes the partial file and reports the error on failure (item 148)', async () => {
      const failing = vi.fn((_s: string, destination: string) => {
        fs.writeFileSync(destination, 'partial');
        return Promise.reject(new Error('bad codec'));
      });
      const { takes } = setup({ importAudio: failing });
      takes.rememberPick({ path: 'x.mp3', recordedAtMs: clock });
      const result = await takes.importPicked('Call');
      expect(result).toEqual({ imported: false, message: 'bad codec' });
      expect(fs.existsSync(path.join(inbox, '2026-05-03 Call.wav'))).toBe(false);
    });

    it('needs a pick, uses it once, and refuses while a recording runs', async () => {
      const { takes } = setup();
      expect(await takes.importPicked('a')).toMatchObject({ imported: false });
      takes.rememberPick({ path: 'x.mp3', recordedAtMs: clock });
      await takes.start('a', mic);
      expect(await takes.importPicked('a')).toMatchObject({ imported: false });
      await takes.stop();
      takes.rememberPick({ path: 'x.mp3', recordedAtMs: clock });
      expect(await takes.importPicked('b')).toMatchObject({ imported: true });
      expect(await takes.importPicked('b')).toMatchObject({ imported: false });
    });
  });
});

function datePart(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
