import {
  audioWorkerCommandSchema,
  type AudioWorkerCommand,
  type AudioWorkerEvent,
} from '@vozella/contracts';
import type { CaptureSession } from '@vozella/core';
import type { NativePorts } from '@vozella/platform';

export interface AudioWorkerDeps {
  /** Builds the ports on first use, so a missing addon is reported as a message, not a crash. */
  readonly createPorts: () => NativePorts;
  readonly post: (event: AudioWorkerEvent) => void;
}

/**
 * The audio utilityProcess brain, free of Electron so it can be tested. One capture at a
 * time; every failure becomes an `error` event.
 */
export function createAudioWorker(deps: AudioWorkerDeps): (raw: unknown) => Promise<void> {
  let ports: NativePorts | undefined;
  let session: CaptureSession | undefined;

  const getPorts = (): NativePorts => (ports ??= deps.createPorts());

  const handle = async (command: AudioWorkerCommand): Promise<void> => {
    switch (command.type) {
      case 'ping': {
        const p = getPorts();
        deps.post({ type: 'pong', backend: p.backend, platformSupported: p.platformSupported });
        return;
      }
      case 'start': {
        if (session) {
          deps.post({ type: 'error', message: 'capture already running' });
          return;
        }
        session = await getPorts().audio.start(command.source, (frame) => {
          deps.post({
            type: 'frame',
            pcm: frame.pcm,
            tsMs: frame.tsMs,
            synthesized: frame.synthesized,
          });
        });
        deps.post({ type: 'started' });
        return;
      }
      case 'shutdown':
        session?.stop();
        session = undefined;
        return;
      case 'stop': {
        const stats = session?.stop();
        session = undefined;
        deps.post({
          type: 'stopped',
          stats: stats ?? {
            frames: 0,
            realSamples: 0,
            synthesizedSamples: 0,
            packets: 0,
            silentFlagPackets: 0,
            discontinuities: 0,
          },
        });
        return;
      }
    }
  };

  return async (raw) => {
    const parsed = audioWorkerCommandSchema.safeParse(raw);
    if (!parsed.success) {
      deps.post({ type: 'error', message: 'invalid command' });
      return;
    }
    try {
      await handle(parsed.data);
    } catch (error) {
      deps.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };
}
