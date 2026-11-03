// utilityProcess entry for speech recognition. koffi is external to the bundle and loaded on
// demand, so a broken install is reported as a message instead of a crashed worker.
import { createAsrWorker } from './asr-worker-core';
import { loadNemoLibrary, type Koffi } from './nemo-library';

const parentPort = process.parentPort;

let koffiModule: Koffi | undefined;
// A real require, so rolldown leaves koffi's native binary to runtime.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireKoffi = (): Koffi => (koffiModule ??= require('koffi') as Koffi);

const handle = createAsrWorker({
  post: (event) => {
    parentPort.postMessage(event);
  },
  koffiVersion: () => {
    try {
      return Promise.resolve(requireKoffi().version);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  },
  openLibrary: (binDir) => loadNemoLibrary(requireKoffi(), binDir),
});

parentPort.on('message', (event) => {
  void handle(event.data).then(() => {
    if ((event.data as { type?: unknown }).type === 'shutdown') {
      setTimeout(() => process.exit(0), 50);
    }
  });
});
