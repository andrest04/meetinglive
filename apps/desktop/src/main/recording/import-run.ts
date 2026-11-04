import { importTimes, type CancelSignal, type Message } from '@vozella/core';

export interface ImportConversionDeps {
  /** Converts any supported file to 16 kHz mono PCM16 WAV (multi-channel is downmixed, B-5). */
  convert(source: string, destination: string): Promise<void>;
  /** Stops a conversion in progress. */
  cancelConversion(): void;
  /** The dated WAV path in the destination folder. */
  allocate(title: string, atMs: number): string | Promise<string>;
  wavDurationSeconds(file: string): number;
  remove(file: string): void;
  nowMs(): number;
}

export type ImportConversion =
  | {
      readonly ok: true;
      readonly path: string;
      readonly recordedAtMs: number;
      readonly endedAtMs: number;
    }
  | { readonly ok: false; readonly cancelled: boolean; readonly message: Message };

/**
 * Spec 2.12 step 5 and 6. Converts the file, reads the duration and derives the times (B-19).
 * A failure or a cancel removes the partial WAV; only an error carries a message to show.
 */
export async function convertForImport(
  deps: ImportConversionDeps,
  request: { source: string; title: string; fileTimeMs: number | null },
  cancel: CancelSignal,
): Promise<ImportConversion> {
  let destination: string | null = null;
  const removePartial = (): void => {
    if (destination === null) return;
    try {
      deps.remove(destination);
    } catch {
      // A partial file we cannot delete is left for the user; the failure is already reported.
    }
  };
  const stopListening = cancel.onCancel(() => {
    deps.cancelConversion();
  });
  try {
    // The stem carries the date of the file; the real start is known once the length is read.
    destination = await deps.allocate(request.title, request.fileTimeMs ?? deps.nowMs());
    await deps.convert(request.source, destination);
    if (cancel.cancelled) {
      removePartial();
      return cancelled();
    }
    const durationMs = Math.round(deps.wavDurationSeconds(destination) * 1000);
    const times = importTimes(request.fileTimeMs, durationMs, deps.nowMs());
    return { ok: true, path: destination, ...times };
  } catch (error) {
    removePartial();
    if (cancel.cancelled) return cancelled();
    const text = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      cancelled: false,
      message: { key: 'Error_ImportAudio', args: [text] },
    };
  } finally {
    stopListening();
  }
}

function cancelled(): ImportConversion {
  return { ok: false, cancelled: true, message: { key: 'Status_ProcessingCancelled', args: [] } };
}
