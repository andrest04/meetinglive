import fs from 'node:fs';
import path from 'node:path';
import { fileStem } from '@vozella/core';

export interface AudioPathRequest {
  /** The directory of the destination folder (the Inbox when there is none). */
  readonly directory: string;
  readonly title: string;
  readonly atMs: number;
  /** True when the Markdown at this path belongs to the meeting the take writes to (B-9). */
  readonly ownsMarkdown: (markdownPath: string) => Promise<boolean>;
  readonly exists?: (file: string) => boolean;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Spec 3.14 `AllocateFileStem` with the real id lookup (B-9, 187). A Markdown at the dated stem
 * that belongs to this meeting is accepted when no recording sits beside it, so the WAV and the
 * Markdown the repository writes later share one stem; any other Markdown, or any WAV, pushes
 * the take to the next number. A re-recording never writes over the audio of the first take.
 */
export async function allocateAudioPath(request: AudioPathRequest): Promise<string> {
  const exists = request.exists ?? ((file: string): boolean => fs.existsSync(file));
  fs.mkdirSync(request.directory, { recursive: true });
  const stem = fileStem(localDate(request.atMs), request.title);
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? stem : `${stem} ${n}`;
    const wav = path.join(request.directory, `${candidate}.wav`);
    const markdown = path.join(request.directory, `${candidate}.md`);
    if (exists(markdown)) {
      if (!exists(wav) && (await request.ownsMarkdown(markdown))) return wav;
      continue;
    }
    if (!exists(wav)) return wav;
  }
}
