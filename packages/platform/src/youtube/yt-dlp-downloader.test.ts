import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { CancelSource, isCancellation, type CancelSignal } from '@vozella/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { YtDlpDownloader, YtDlpError } from './yt-dlp-downloader';

const ID = 'dQw4w9WgXcQ';
const URL = `https://youtu.be/${ID}`;
const EXE = 'C:\\bin\\yt-dlp.exe';
const never: CancelSignal = new CancelSource().signal;

class FakeChild extends EventEmitter {
  readonly pid = 4242;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);

  exit(code: number): void {
    this.stdout.end();
    this.stderr.end();
    setImmediate(() => this.emit('close', code));
  }
}

let dir: string;
let root: string;
beforeEach(() => {
  const base = process.env.VOZELLA_DATA_ROOT ?? os.tmpdir();
  fs.mkdirSync(base, { recursive: true });
  root = fs.mkdtempSync(path.join(base, 'yt-dlp-downloader-'));
  dir = path.join(root, 'out');
  fs.mkdirSync(dir);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function setup(script: (child: FakeChild) => void) {
  const child = new FakeChild();
  const spawn = vi.fn((_command: string, _args: readonly string[], _options: SpawnOptions) => {
    setImmediate(() => script(child));
    return child as unknown as ChildProcess;
  });
  const killTree = vi.fn((_pid: number | undefined) => {
    child.exit(1);
    return Promise.resolve();
  });
  const downloader = new YtDlpDownloader({
    executable: () => Promise.resolve(EXE),
    spawn,
    killTree,
  });
  return { child, spawn, killTree, downloader };
}

describe('YtDlpDownloader.download', () => {
  it('spawns yt-dlp hidden, without a shell, asking for m4a audio of the single video', async () => {
    const final = path.join(dir, `${ID}.m4a`);
    const { spawn, downloader } = setup((child) => {
      fs.writeFileSync(final, 'audio');
      child.stdout.write(`${final}\n`);
      child.exit(0);
    });

    await downloader.download(URL, dir, never);

    const [command, args, options] = spawn.mock.calls[0] ?? [];
    expect(command).toBe(EXE);
    expect(options).toMatchObject({ shell: false, windowsHide: true });
    expect(args).toEqual([
      '-f',
      'bestaudio[ext=m4a]/bestaudio',
      '--no-playlist',
      '--no-part',
      '--no-progress',
      '--encoding',
      'utf-8',
      '-o',
      path.join(dir, '%(id)s.%(ext)s'),
      '--print',
      'after_move:filepath',
      `https://www.youtube.com/watch?v=${ID}`,
    ]);
  });

  it('returns the final path that yt-dlp prints', async () => {
    const final = path.join(dir, `${ID}.m4a`);
    const { downloader } = setup((child) => {
      fs.writeFileSync(final, 'audio');
      child.stdout.write(`[info] something\r\n${final}\r\n`);
      child.exit(0);
    });

    await expect(downloader.download(URL, dir, never)).resolves.toBe(final);
  });

  it('maps a non-zero exit to YtDlpError with the trimmed stderr tail', async () => {
    const noise = 'x'.repeat(2000);
    const { downloader } = setup((child) => {
      child.stderr.write(`${noise}\nERROR: [youtube] ${ID}: Video unavailable\n\n`);
      child.exit(1);
    });

    const error = await downloader.download(URL, dir, never).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(YtDlpError);
    const { exitCode, stderrTail } = error as YtDlpError;
    expect(exitCode).toBe(1);
    expect(stderrTail.length).toBeLessThanOrEqual(500);
    expect(stderrTail.endsWith(`ERROR: [youtube] ${ID}: Video unavailable`)).toBe(true);
  });

  it('removes files it left behind when it fails', async () => {
    const { downloader } = setup((child) => {
      fs.writeFileSync(path.join(dir, `${ID}.m4a`), 'partial');
      child.exit(1);
    });
    fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'keep');

    await expect(downloader.download(URL, dir, never)).rejects.toBeInstanceOf(YtDlpError);
    expect(fs.readdirSync(dir)).toEqual(['unrelated.txt']);
  });

  it('fails when yt-dlp exits 0 without printing an existing file', async () => {
    const { downloader } = setup((child) => {
      child.stdout.write(path.join(dir, `${ID}.m4a`));
      child.exit(0);
    });

    await expect(downloader.download(URL, dir, never)).rejects.toBeInstanceOf(YtDlpError);
  });

  it('kills the process tree on cancel, removes the partial file and throws CancelledError', async () => {
    const cancel = new CancelSource();
    const partial = path.join(dir, `${ID}.m4a`);
    const { child, killTree, downloader } = setup(() => {
      fs.writeFileSync(partial, 'half');
      cancel.cancel();
    });

    const error = await downloader.download(URL, dir, cancel.signal).catch((e: unknown) => e);

    expect(isCancellation(error)).toBe(true);
    expect(killTree).toHaveBeenCalledWith(child.pid);
    expect(fs.existsSync(partial)).toBe(false);
  });

  it('does not spawn when already cancelled', async () => {
    const cancel = new CancelSource();
    cancel.cancel();
    const { spawn, downloader } = setup((child) => child.exit(0));

    const error = await downloader.download(URL, dir, cancel.signal).catch((e: unknown) => e);

    expect(isCancellation(error)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses a link that is not a YouTube video', async () => {
    const { spawn, downloader } = setup((child) => child.exit(0));

    await expect(downloader.download('https://vimeo.com/1', dir, never)).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
  });
});
