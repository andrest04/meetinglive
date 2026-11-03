import fs from 'node:fs';
import path from 'node:path';
import type { MicrophoneChoiceDto } from '@vozella/contracts';
import { fileStem, type Logger } from '@vozella/core';
import type { AudioController } from './audio-controller';

/** The slice of AudioController a take uses. */
export type TakeController = Pick<
  AudioController,
  'startRecording' | 'pause' | 'resume' | 'stop' | 'importAudio'
>;

export interface RecordingTakesDeps {
  readonly controller: TakeController;
  /** The library's Inbox, read on every use because the library root can change. */
  readonly inboxDirectory: () => string;
  readonly nowMs: () => number;
  readonly wavDurationSeconds: (file: string) => number;
  readonly logger: Logger;
  /**
   * The live transcript pass (transcription module). It starts after the capture is running and
   * stops with the take; its draft is kept for the recording module's pipeline.
   */
  readonly live?: LivePass;
}

export interface LivePass {
  start(recordedAtMs: number): Promise<unknown>;
  /** The draft transcript, or null when there is none. */
  stop(): Promise<string | null>;
}

export type StartOutcome =
  | { readonly started: true; readonly recordedAtMs: number }
  | { readonly started: false; readonly code: string | null; readonly message: string };

export interface StopOutcome {
  readonly path: string | null;
  readonly recordedAtMs: number | null;
  readonly pausedSeconds: number;
  readonly error: string | null;
}

export type ImportOutcome =
  | {
      readonly imported: true;
      readonly path: string;
      readonly recordedAtMs: number;
      readonly endedAtMs: number;
      readonly durationSeconds: number;
    }
  | { readonly imported: false; readonly message: string };

export interface PickedFile {
  readonly path: string;
  readonly recordedAtMs: number;
}

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping' | 'importing';

/**
 * One take at a time: a recording from Record to Stop, or one import (the capture half of the
 * recording module's spec 2.2 and 2.12). The page never names a file; this class allocates the WAV
 * in the Inbox, keeps the time spent paused for the live transcript clock, and turns failures into
 * the values the page shows. The meeting record and the pipeline that follow belong to the
 * recording module, which takes over `stop` and `importPicked`.
 */
export class RecordingTakes {
  private phase: Phase = 'idle';
  private file: string | null = null;
  private recordedAtMs: number | null = null;
  private pausedMs = 0;
  private pausedAt: number | null = null;
  private picked: PickedFile | null = null;
  /** The live transcript of the take that just ended, for the recording module's pipeline. */
  private liveDraft: string | null = null;

  constructor(private readonly deps: RecordingTakesDeps) {}

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** The draft the live pass left at the last Stop; null when there was none. */
  get lastLiveDraft(): string | null {
    return this.liveDraft;
  }

  async start(title: string, microphone: MicrophoneChoiceDto): Promise<StartOutcome> {
    if (this.phase !== 'idle') {
      return { started: false, code: 'busy', message: 'A take is already in progress.' };
    }
    this.phase = 'starting';
    const recordedAtMs = this.deps.nowMs();
    try {
      const file = this.allocate(title, recordedAtMs);
      this.file = file;
      this.recordedAtMs = recordedAtMs;
      this.pausedMs = 0;
      this.pausedAt = null;
      this.liveDraft = null;
      // C# order: the model loads first so no frame is missed and the live clock starts with the audio.
      await this.startLive(recordedAtMs);
      try {
        await this.deps.controller.startRecording(file, microphone);
      } catch (error) {
        await this.stopLive();
        throw error;
      }
      this.phase = 'recording';
      return { started: true, recordedAtMs };
    } catch (error) {
      this.reset();
      return { started: false, code: codeOf(error), message: messageOf(error) };
    }
  }

  async pause(): Promise<boolean> {
    if (this.phase !== 'recording') return false;
    await this.deps.controller.pause();
    this.pausedAt = this.deps.nowMs();
    this.phase = 'paused';
    return true;
  }

  async resume(): Promise<boolean> {
    if (this.phase !== 'paused') return false;
    await this.deps.controller.resume();
    this.closePause();
    this.phase = 'recording';
    return true;
  }

  async stop(): Promise<StopOutcome> {
    if (this.phase !== 'recording' && this.phase !== 'paused') {
      return { path: null, recordedAtMs: null, pausedSeconds: 0, error: null };
    }
    this.closePause();
    this.phase = 'stopping';
    const outcome = { path: this.file, recordedAtMs: this.recordedAtMs };
    const pausedSeconds = this.pausedMs / 1000;
    let error: string | null = null;
    try {
      await this.deps.controller.stop();
    } catch (caught) {
      error = messageOf(caught);
      this.deps.logger.warn('stopping the recording failed', { error });
    }
    await this.stopLive();
    this.reset();
    return { ...outcome, pausedSeconds, error };
  }

  /** Spec 2.3: if the live pass cannot start, the take fails before any audio is captured. */
  private async startLive(recordedAtMs: number): Promise<void> {
    await this.deps.live?.start(recordedAtMs);
  }

  private async stopLive(): Promise<void> {
    if (!this.deps.live) return;
    try {
      this.liveDraft = await this.deps.live.stop();
    } catch (error) {
      this.deps.logger.warn('the live transcript did not stop cleanly', {
        error: messageOf(error),
      });
      this.liveDraft = null;
    }
  }

  /** Remembers the file the user picked; `importPicked` takes it once. */
  rememberPick(pick: PickedFile | null): void {
    this.picked = pick;
  }

  async importPicked(title: string): Promise<ImportOutcome> {
    const pick = this.picked;
    if (this.phase !== 'idle') {
      return { imported: false, message: 'A take is already in progress.' };
    }
    if (pick === null) return { imported: false, message: 'No file was picked.' };
    this.picked = null;
    this.phase = 'importing';
    let destination: string | null = null;
    try {
      destination = this.allocate(title, pick.recordedAtMs);
      await this.deps.controller.importAudio(pick.path, destination);
      const durationSeconds = this.deps.wavDurationSeconds(destination);
      return {
        imported: true,
        path: destination,
        recordedAtMs: pick.recordedAtMs,
        endedAtMs: pick.recordedAtMs + Math.round(durationSeconds * 1000),
        durationSeconds,
      };
    } catch (error) {
      if (destination !== null) removeQuietly(destination);
      return { imported: false, message: messageOf(error) };
    } finally {
      this.phase = 'idle';
    }
  }

  private closePause(): void {
    if (this.pausedAt !== null) this.pausedMs += this.deps.nowMs() - this.pausedAt;
    this.pausedAt = null;
  }

  private reset(): void {
    this.phase = 'idle';
    this.file = null;
    this.recordedAtMs = null;
    this.pausedAt = null;
  }

  /** Spec 3.3 `AllocateFileStem`: the next free number when the Markdown or the WAV exists. */
  private allocate(title: string, atMs: number): string {
    const directory = this.deps.inboxDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const stem = fileStem(localDate(atMs), title);
    for (let n = 1; ; n += 1) {
      const candidate = n === 1 ? stem : `${stem} ${n}`;
      const wav = path.join(directory, `${candidate}.wav`);
      const markdown = path.join(directory, `${candidate}.md`);
      if (!fs.existsSync(wav) && !fs.existsSync(markdown)) return wav;
    }
  }
}

function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // A partial file we cannot remove is left for the user; the error is already reported.
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}
