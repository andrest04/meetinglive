import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocateAudioPath } from './audio-path';

let dir: string;
const at = new Date(2026, 10, 3, 9, 30).getTime();
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-audio-path-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const never = () => Promise.resolve(false);
const run = (ownsMarkdown = never) =>
  allocateAudioPath({ directory: dir, title: 'Standup', atMs: at, ownsMarkdown });

describe('allocateAudioPath', () => {
  it('uses the dated stem in the given directory', async () => {
    expect(await run()).toBe(path.join(dir, '2026-11-03 Standup.wav'));
  });

  it('creates the directory', async () => {
    const nested = path.join(dir, 'Clients', 'Acme');
    const file = await allocateAudioPath({
      directory: nested,
      title: 'Call',
      atMs: at,
      ownsMarkdown: never,
    });
    expect(path.dirname(file)).toBe(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('skips a stem whose Markdown belongs to another meeting', async () => {
    fs.writeFileSync(path.join(dir, '2026-11-03 Standup.md'), '');
    expect(await run()).toBe(path.join(dir, '2026-11-03 Standup 2.wav'));
  });

  it('B-9: accepts the stem whose Markdown is this meeting and has no recording', async () => {
    fs.writeFileSync(path.join(dir, '2026-11-03 Standup.md'), '');
    expect(await run(() => Promise.resolve(true))).toBe(path.join(dir, '2026-11-03 Standup.wav'));
  });

  it('never writes over the recording of an earlier take of the same meeting', async () => {
    fs.writeFileSync(path.join(dir, '2026-11-03 Standup.md'), '');
    fs.writeFileSync(path.join(dir, '2026-11-03 Standup.wav'), 'old');
    expect(await run(() => Promise.resolve(true))).toBe(path.join(dir, '2026-11-03 Standup 2.wav'));
  });

  it('skips a stem that only has a WAV', async () => {
    fs.writeFileSync(path.join(dir, '2026-11-03 Standup.wav'), 'x');
    expect(await run()).toBe(path.join(dir, '2026-11-03 Standup 2.wav'));
  });
});
