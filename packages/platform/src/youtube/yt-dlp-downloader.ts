import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import nodePath from 'node:path';
import {
  CancelledError,
  parseYouTubeUrl,
  throwIfCancelled,
  type CancelSignal,
} from '@vozella/core';
import { killProcessTree } from '../summaries/cli-process-runner';

const STDERR_TAIL_CHARS = 500;
/** How long to wait for the killed process to release its files before cleaning up anyway. */
const EXIT_AFTER_KILL_MS = 5_000;

/** yt-dlp exited with an error. `stderrTail` is the trimmed end of its stderr, for the log. */
export class YtDlpError extends Error {
  constructor(
    readonly exitCode: number,
    readonly stderrTail: string,
    message = `yt-dlp exited with code ${String(exitCode)}.`,
  ) {
    super(message);
    this.name = 'YtDlpError';
  }
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface YtDlpDownloaderOptions {
  /** Path of `yt-dlp.exe`; production passes `() => manager.ensure(cancel)`. */
  readonly executable: () => Promise<string>;
  /** Tests replace it; defaults to `child_process.spawn`. */
  readonly spawn?: SpawnProcess;
  /** Tests replace it; defaults to `killProcessTree`. */
  readonly killTree?: (pid: number | undefined) => Promise<void>;
}

/**
 * yt-dlp arguments for the audio of one video. m4a comes first because the native decoder is
 * Media Foundation, which may not read webm or opus. `--no-part` keeps the file name predictable
 * so a cancel can remove it.
 */
export function buildYtDlpArgs(videoUrl: string, destinationDir: string): string[] {
  return [
    '-f',
    'bestaudio[ext=m4a]/bestaudio',
    '--no-playlist',
    '--no-part',
    '--no-progress',
    '--encoding',
    'utf-8',
    '-o',
    nodePath.join(destinationDir, '%(id)s.%(ext)s'),
    '--print',
    'after_move:filepath',
    videoUrl,
  ];
}

function tail(text: string): string {
  return text.trim().slice(-STDERR_TAIL_CHARS).trim();
}

function collect(stream: NodeJS.ReadableStream | null): Promise<string> {
  return new Promise((resolve) => {
    if (stream === null) {
      resolve('');
      return;
    }
    const chunks: Buffer[] = [];
    const done = (): void => resolve(Buffer.concat(chunks).toString('utf8'));
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.once('end', done);
    stream.once('error', done);
    stream.once('close', done);
  });
}

/** Downloads the audio of one YouTube video with yt-dlp into a folder the caller owns. */
export class YtDlpDownloader {
  constructor(private readonly options: YtDlpDownloaderOptions) {}

  /** Resolves with the downloaded file. Cancel kills the process tree and removes partial files. */
  async download(url: string, destinationDir: string, cancel: CancelSignal): Promise<string> {
    const video = parseYouTubeUrl(url);
    if (video === null) throw new Error('The link is not a YouTube video.');
    throwIfCancelled(cancel);
    const exe = await this.options.executable();
    throwIfCancelled(cancel);
    await fsp.mkdir(destinationDir, { recursive: true });

    const child = (this.options.spawn ?? nodeSpawn)(
      exe,
      buildYtDlpArgs(video.url, destinationDir),
      { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const exited = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code: number | null) => resolve(code ?? 1));
    });
    exited.catch(() => undefined);
    const output = Promise.all([collect(child.stdout), collect(child.stderr), exited]);
    output.catch(() => undefined);

    let onCancel: () => void = () => undefined;
    const cancelled = new Promise<'cancelled'>((resolve) => {
      onCancel = () => resolve('cancelled');
    });
    const unsubscribe = cancel.onCancel(onCancel);

    try {
      const outcome = await Promise.race([output, cancelled]);
      if (outcome === 'cancelled') {
        await (this.options.killTree ?? killProcessTree)(child.pid);
        child.kill();
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          exited.catch(() => undefined),
          new Promise((resolve) => (timer = setTimeout(resolve, EXIT_AFTER_KILL_MS))),
        ]);
        clearTimeout(timer);
        throw new CancelledError();
      }
      const [stdout, stderr, exitCode] = outcome;
      if (exitCode !== 0) throw new YtDlpError(exitCode, tail(stderr));
      const printed = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .at(-1);
      if (printed === undefined || !fs.existsSync(printed)) {
        throw new YtDlpError(0, tail(stderr), 'yt-dlp finished without producing an audio file.');
      }
      return printed;
    } catch (error) {
      await removeLeftovers(destinationDir, video.videoId);
      throw error;
    } finally {
      unsubscribe();
    }
  }
}

/** Removes `<id>.*` files (the output and any fragments) yt-dlp left in the folder. */
async function removeLeftovers(dir: string, videoId: string): Promise<void> {
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith(`${videoId}.`))
      .map((name) => fsp.rm(nodePath.join(dir, name), { force: true }).catch(() => undefined)),
  );
}
