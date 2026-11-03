// utilityProcess entry for speech recognition (skeleton). koffi is external to the bundle
// and loaded on demand.
import path from 'node:path';
import { createAsrWorker } from './asr-worker-core';

const parentPort = process.parentPort;

const handle = createAsrWorker({
  post: (event) => {
    parentPort.postMessage(event);
  },
  join: (...parts) => path.join(...parts),
  loadKoffi: async () => {
    const koffi = (await import('koffi')).default;
    return koffi;
  },
  prepareDllDirectory: (binDir, koffi) => {
    const kernel32 = koffi.load('kernel32.dll');
    const setDllDirectory = kernel32.func('int __stdcall SetDllDirectoryW(const char16_t *path)');
    (setDllDirectory as (dir: string) => unknown)(path.resolve(binDir));
    process.env.PATH = `${path.resolve(binDir)};${process.env.PATH ?? ''}`;
  },
});

parentPort.on('message', (event) => {
  void handle(event.data).then(() => {
    if ((event.data as { type?: unknown }).type === 'shutdown') {
      setTimeout(() => process.exit(0), 50);
    }
  });
});
