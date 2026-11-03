import {
  asrWorkerCommandSchema,
  type AsrResultDto,
  type AsrRpcCall,
  type AsrWorkerCommand,
  type AsrWorkerEvent,
} from '@vozella/contracts';
import { rightContextFrames } from '@vozella/core';
import type { NativeHandle, NemoLibrary } from './nemo-library';

export interface AsrWorkerDeps {
  /** koffi's version, or a rejection when the install is broken. Used by ping. */
  readonly koffiVersion: () => Promise<string>;
  /** Loads the engine from a folder (koffi in production, a double in tests). */
  readonly openLibrary: (binDir: string) => NemoLibrary;
  readonly post: (event: AsrWorkerEvent) => void;
}

interface RecognizerEntry {
  readonly library: NemoLibrary;
  readonly handle: NativeHandle;
  readonly streams: Set<string>;
}

interface StreamEntry {
  readonly library: NemoLibrary;
  readonly handle: NativeHandle;
  readonly recognizerId: string;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The ASR utilityProcess (spec 3.5, gaps section 2). It owns every native handle: a recognizer
 * owns its streams, a stream is closed before its recognizer is destroyed, each dispose runs
 * once, and a library is loaded once per folder and never released.
 */
export function createAsrWorker(deps: AsrWorkerDeps): (raw: unknown) => Promise<void> {
  const libraries = new Map<string, NemoLibrary>();
  const recognizers = new Map<string, RecognizerEntry>();
  const streams = new Map<string, StreamEntry>();

  /** Loads are serialized by the single message loop; a failed load caches nothing, so the next call retries. */
  const libraryFor = (binDir: string): NemoLibrary => {
    const key = binDir.toLowerCase();
    const cached = libraries.get(key);
    if (cached) return cached;
    const library = deps.openLibrary(binDir);
    libraries.set(key, library);
    return library;
  };

  const disposeStream = (id: string): void => {
    const entry = streams.get(id);
    if (!entry) return;
    streams.delete(id);
    recognizers.get(entry.recognizerId)?.streams.delete(id);
    entry.library.closeStream(entry.handle);
  };

  const disposeRecognizer = (id: string): void => {
    const entry = recognizers.get(id);
    if (!entry) return;
    for (const streamId of [...entry.streams]) disposeStream(streamId);
    recognizers.delete(id);
    entry.library.destroyRecognizer(entry.handle);
  };

  const rpc = (call: AsrRpcCall): unknown => {
    switch (call.method) {
      case 'createRecognizer': {
        if (recognizers.has(call.recognizerId)) throw new Error('recognizer id already in use');
        const library = libraryFor(call.settings.binDirectory);
        const handle = library.createRecognizer({
          modelPath: call.settings.modelPath,
          gpu: call.settings.gpu,
          diarizationModelPath: call.settings.diarizationModelPath,
          geometry: call.settings.geometry,
          rnntRightContext: rightContextFrames(call.settings.latency),
        });
        recognizers.set(call.recognizerId, { library, handle, streams: new Set() });
        return null;
      }
      case 'startStream': {
        const recognizer = recognizers.get(call.recognizerId);
        if (!recognizer) throw new Error('unknown recognizer');
        if (streams.has(call.streamId)) throw new Error('stream id already in use');
        const handle = recognizer.library.startStream(recognizer.handle, call.options);
        streams.set(call.streamId, {
          library: recognizer.library,
          handle,
          recognizerId: call.recognizerId,
        });
        recognizer.streams.add(call.streamId);
        return null;
      }
      case 'push': {
        const stream = streams.get(call.streamId);
        if (!stream) throw new Error('unknown stream');
        stream.library.pushF32(stream.handle, call.samples, call.sampleRate);
        return null;
      }
      case 'pull': {
        const stream = streams.get(call.streamId);
        if (!stream) throw new Error('unknown stream');
        const results: AsrResultDto[] = [];
        for (;;) {
          const result = stream.library.next(stream.handle);
          if (result === null) return results;
          results.push(result);
        }
      }
      case 'disposeStream':
        disposeStream(call.streamId);
        return null;
      case 'disposeRecognizer':
        disposeRecognizer(call.recognizerId);
        return null;
    }
  };

  const handle = (command: AsrWorkerCommand): void => {
    switch (command.type) {
      case 'ping':
        void deps
          .koffiVersion()
          .then(
            (koffi) => koffi,
            () => null,
          )
          .then((koffi) => {
            deps.post({ type: 'pong', koffi });
          });
        return;
      case 'load': {
        const library = libraryFor(command.binDir);
        deps.post({ type: 'loaded', version: library.version });
        return;
      }
      case 'rpc':
        try {
          deps.post({ type: 'rpc-result', id: command.id, ok: true, result: rpc(command.call) });
        } catch (error) {
          deps.post({ type: 'rpc-result', id: command.id, ok: false, message: message(error) });
        }
        return;
      case 'shutdown':
        // Streams and recognizers are closed on the way out; the library is left loaded.
        for (const id of [...recognizers.keys()]) {
          try {
            disposeRecognizer(id);
          } catch {
            // The process is ending.
          }
        }
        return;
    }
  };

  return (raw) => {
    const parsed = asrWorkerCommandSchema.safeParse(raw);
    if (!parsed.success) {
      deps.post({ type: 'error', message: 'invalid command' });
      return Promise.resolve();
    }
    try {
      handle(parsed.data);
    } catch (error) {
      deps.post({ type: 'error', message: message(error) });
    }
    return Promise.resolve();
  };
}
