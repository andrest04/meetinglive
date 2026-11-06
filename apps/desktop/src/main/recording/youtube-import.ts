import fs from 'node:fs';
import nodePath from 'node:path';
import { isCancellation, type CancelSignal, type Logger, type Message } from '@vozella/core';
import { YtDlpDownloader, YtDlpError, YtDlpInstallError, YtDlpManager } from '@vozella/platform';

/** What the YouTube import needs from yt-dlp and the temp folder (spec 2.12, from a link). */
export interface YouTubeAudioPort {
  /** Installs yt-dlp on first use; resolves once it can run. */
  ensure(cancel: CancelSignal): Promise<unknown>;
  /** The once-per-session self-update. Never rejects. */
  update(): Promise<void>;
  /** Downloads the audio of one video into `directory`; resolves with the file. */
  download(url: string, directory: string, cancel: CancelSignal): Promise<string>;
  /** The temp folder that holds the download of one import. */
  workDirectory(meetingId: string): string;
  /** Removes a temp folder and everything in it. Never throws. */
  removeDirectory(directory: string): void;
}

/** The outcome of a failed or cancelled download, in the shape of a failed conversion. */
export interface YouTubeFailure {
  readonly cancelled: boolean;
  readonly message: Message;
}

/** The line of a yt-dlp stderr tail worth showing: the last `ERROR:` line, else the last line. */
export function ytDlpErrorLine(stderrTail: string): string {
  const lines = stderrTail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const error = lines.findLast((line) => line.startsWith('ERROR:'));
  return (error ?? lines.at(-1) ?? '').replace(/^ERROR:\s*/, '');
}

/** Maps a download error to the message the Record screen shows. */
export function youTubeFailure(error: unknown, cancel: CancelSignal): YouTubeFailure {
  if (cancel.cancelled || isCancellation(error)) {
    return { cancelled: true, message: { key: 'Status_ProcessingCancelled', args: [] } };
  }
  if (error instanceof YtDlpInstallError) {
    return { cancelled: false, message: { key: 'Ui_ErrorYtDlpInstall', args: [] } };
  }
  const detail =
    error instanceof YtDlpError
      ? ytDlpErrorLine(error.stderrTail) || error.message
      : error instanceof Error
        ? error.message
        : String(error);
  return { cancelled: false, message: { key: 'Ui_ErrorYouTubeDownload', args: [detail] } };
}

export interface YouTubeAudioOptions {
  /** Folder under app data that keeps `yt-dlp.exe`. */
  readonly binDir: string;
  /** Root of the per-import temp folders, e.g. `os.tmpdir()/vozella-youtube`. */
  readonly tempRoot: string;
  readonly logger: Logger;
}

/** The production port: the yt-dlp manager and downloader from the platform package. */
export function createYouTubeAudio(options: YouTubeAudioOptions): YouTubeAudioPort {
  const manager = new YtDlpManager({ binDir: options.binDir, logger: options.logger });
  return {
    ensure: (cancel) => manager.ensure(cancel),
    update: () => manager.update(),
    download: (url, directory, cancel) =>
      new YtDlpDownloader({ executable: () => manager.ensure(cancel) }).download(
        url,
        directory,
        cancel,
      ),
    workDirectory: (meetingId) => nodePath.join(options.tempRoot, meetingId),
    removeDirectory: (directory) => {
      try {
        fs.rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        options.logger.warn('could not remove the YouTube temp folder', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
