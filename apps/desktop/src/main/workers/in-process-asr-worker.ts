import { createAsrWorker } from '../../workers/asr/asr-worker-core';
import type { NemoLibrary } from '../../workers/asr/nemo-library';
import type { WorkerProcess } from './managed-worker';

export interface InProcessAsrWorker extends WorkerProcess {
  /** Simulates the process dying. */
  crash(code?: number): void;
}

/**
 * The ASR worker running inside the calling process, behind the same message protocol. Messages
 * are structured-cloned both ways like the real IPC. For tests and the integration proof; the
 * app uses a utilityProcess.
 */
export function inProcessAsrWorker(
  openLibrary: (binDir: string) => NemoLibrary,
  koffiVersion: () => Promise<string> = () => Promise.resolve('in-process'),
): InProcessAsrWorker {
  const listeners: ((message: unknown) => void)[] = [];
  const exitListeners: ((code: number) => void)[] = [];
  let alive = true;
  const handle = createAsrWorker({
    koffiVersion,
    openLibrary,
    post: (event) => {
      const copy = structuredClone(event);
      setImmediate(() => {
        if (alive) for (const listener of listeners) listener(copy);
      });
    },
  });
  const end = (code: number): void => {
    if (!alive) return;
    alive = false;
    setImmediate(() => {
      for (const listener of exitListeners) listener(code);
    });
  };
  return {
    postMessage: (message) => {
      if (!alive) return;
      const copy = structuredClone(message);
      setImmediate(() => {
        void handle(copy).then(() => {
          if ((copy as { type?: unknown }).type === 'shutdown') end(0);
        });
      });
    },
    onMessage: (listener) => {
      listeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    kill: () => {
      end(1);
    },
    crash: (code = 3221226505) => {
      end(code);
    },
  };
}
