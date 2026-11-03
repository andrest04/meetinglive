// utilityProcess entry for audio capture. Loads the Rust addon (or the fakes) and speaks the
// protocol in packages/contracts/src/workers.ts with the main process.
import { createNativePorts, seedFakeAudioApps, type FakeAudioApp } from '@vozella/platform';
import { createAudioWorker, parseMainProcessId } from './audio-worker-core';

const parentPort = process.parentPort;

const handle = createAudioWorker({
  mainProcessId: parseMainProcessId(process.env.VOZELLA_MAIN_PID),
  post: (event) => {
    parentPort.postMessage(event);
  },
  createPorts: () => {
    if (process.env.VOZELLA_FAKE_NATIVE === '1') {
      const ports = createNativePorts({ fake: true });
      // E2E and screenshots only: apps that "play" audio in the fake build.
      const seeded = process.env.VOZELLA_FAKE_AUDIO_APPS;
      if (seeded) seedFakeAudioApps(ports, JSON.parse(seeded) as FakeAudioApp[]);
      return ports;
    }
    const addonPath = process.env.VOZELLA_NATIVE_ADDON;
    if (!addonPath) throw new Error('VOZELLA_NATIVE_ADDON is not set');
    return createNativePorts({
      fake: false,
      addonPath,
      // A real require, so rolldown leaves the .node load to runtime.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      load: (path) => require(path) as unknown,
    });
  },
});

parentPort.on('message', (event) => {
  void handle(event.data).then(() => {
    // The host asked the process to end.
    if ((event.data as { type?: unknown }).type === 'shutdown') {
      setTimeout(() => process.exit(0), 50);
    }
  });
});
