import { CancelSource, CancelledError } from '@vozella/core';
import { YtDlpError, YtDlpInstallError } from '@vozella/platform';
import { describe, expect, it } from 'vitest';
import { youTubeFailure, ytDlpErrorLine } from './youtube-import';

describe('ytDlpErrorLine', () => {
  it('keeps the last ERROR line without its prefix', () => {
    const tail = 'WARNING: a\nERROR: [youtube] abc: Private video\nmore\n';
    expect(ytDlpErrorLine(tail)).toBe('[youtube] abc: Private video');
  });

  it('falls back to the last non-empty line, then to nothing', () => {
    expect(ytDlpErrorLine('first\r\nlast\r\n\r\n')).toBe('last');
    expect(ytDlpErrorLine('  ')).toBe('');
  });
});

describe('youTubeFailure', () => {
  it('maps a cancel, an install failure, a yt-dlp failure and anything else', () => {
    const idle = new CancelSource();
    expect(youTubeFailure(new CancelledError(), idle)).toEqual({
      cancelled: true,
      message: { key: 'Status_ProcessingCancelled', args: [] },
    });
    expect(youTubeFailure(new YtDlpInstallError('download-failed', 'offline'), idle)).toEqual({
      cancelled: false,
      message: { key: 'Ui_ErrorYtDlpInstall', args: [] },
    });
    expect(youTubeFailure(new YtDlpError(2, ''), idle).message).toEqual({
      key: 'Ui_ErrorYouTubeDownload',
      args: ['yt-dlp exited with code 2.'],
    });
    expect(youTubeFailure(new Error('spawn ENOENT'), idle).message.args).toEqual(['spawn ENOENT']);
  });

  it('treats any error after a cancel as the cancel', () => {
    const cancel = new CancelSource();
    cancel.cancel();
    expect(youTubeFailure(new Error('killed'), cancel).cancelled).toBe(true);
  });
});
