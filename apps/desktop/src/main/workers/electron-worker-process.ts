import type { Logger } from '@vozella/core';
import { utilityProcess } from 'electron';
import type { WorkerProcess } from './managed-worker';

/** Adapter: an Electron utilityProcess as a WorkerProcess. */
export function forkUtilityWorker(options: {
  readonly name: string;
  readonly modulePath: string;
  readonly env: Record<string, string>;
  readonly logger: Logger;
}): WorkerProcess {
  const child = utilityProcess.fork(options.modulePath, [], {
    serviceName: `vozella-${options.name}`,
    env: { ...process.env, ...options.env },
    stdio: 'pipe',
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    options.logger.warn(`${options.name} worker stderr`, { text: chunk.toString().slice(0, 2000) });
  });
  return {
    postMessage: (message) => {
      child.postMessage(message);
    },
    onMessage: (listener) => {
      child.on('message', listener);
    },
    onExit: (listener) => {
      child.on('exit', listener);
    },
    kill: () => {
      child.kill();
    },
  };
}
