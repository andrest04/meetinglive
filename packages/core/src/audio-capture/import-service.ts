import type { CancelSignal } from '../cancel';
import type { WavWriter } from './recording-service';

/** Importing an audio file as the 16 kHz mono PCM16 WAV recording produces (spec 2.8). */

export const IMPORT_EXTENSIONS = [
  '.wav',
  '.mp3',
  '.m4a',
  '.aac',
  '.flac',
  '.wma',
  '.3gp',
  '.mp4',
] as const;

/** Port: a decoder that yields 16 kHz mono PCM16 little-endian, any source channel count. */
export interface AudioFileDecoder {
  /** The next chunk, or null at the end of the file. */
  read(): Uint8Array | null;
  close(): void;
}

export interface AudioImportDeps {
  readonly fileExists: (path: string) => boolean;
  readonly ensureParentDirectory: (path: string) => void;
  /** Opens the decoder; throws when the file cannot be decoded. */
  readonly openDecoder: (path: string) => AudioFileDecoder;
  readonly createWriter: (path: string) => WavWriter;
  readonly removeFile: (path: string) => void;
  /** Lets queued messages (a cancel) run between buffers. */
  readonly yieldToEventLoop: () => Promise<void>;
}

export class AudioFileNotFoundError extends Error {
  constructor(readonly path: string) {
    super('The audio file was not found.');
    this.name = 'AudioFileNotFoundError';
  }
}

export class ImportCancelledError extends Error {
  constructor() {
    super('The import was cancelled.');
    this.name = 'ImportCancelledError';
  }
}

export class AudioImportService {
  constructor(private readonly deps: AudioImportDeps) {}

  /** Converts `sourcePath` to `destinationPath`. A failure removes the partial destination. */
  async convertToNemotronWav(
    sourcePath: string,
    destinationPath: string,
    cancel?: CancelSignal,
  ): Promise<void> {
    if (sourcePath.trim() === '') throw new Error('The source path is empty.');
    if (destinationPath.trim() === '') throw new Error('The destination path is empty.');
    if (!this.deps.fileExists(sourcePath)) throw new AudioFileNotFoundError(sourcePath);

    try {
      this.deps.ensureParentDirectory(destinationPath);
      const decoder = this.deps.openDecoder(sourcePath);
      let writer: WavWriter | undefined;
      try {
        writer = this.deps.createWriter(destinationPath);
        let total = 0;
        for (;;) {
          const chunk = decoder.read();
          if (chunk === null) break;
          if (chunk.byteLength === 0) continue;
          writer.write(chunk);
          total += chunk.byteLength;
          await this.deps.yieldToEventLoop();
          if (cancel?.cancelled) throw new ImportCancelledError();
        }
        if (total === 0) throw new Error('The audio file contained no samples.');
        writer.flush();
      } finally {
        decoder.close();
        writer?.close();
      }
    } catch (error) {
      try {
        this.deps.removeFile(destinationPath);
      } catch {
        // Best effort.
      }
      throw error;
    }
  }
}

/** The meeting time for an imported file: its last-write time, now when unreadable. */
export function importRecordedAt(lastWriteMs: number | null, nowMs: number): number {
  return lastWriteMs !== null && Number.isFinite(lastWriteMs) && lastWriteMs > 0
    ? lastWriteMs
    : nowMs;
}
