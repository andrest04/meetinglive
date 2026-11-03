import {
  audioWorkerCommandSchema,
  type AudioRpcCall,
  type AudioWorkerCommand,
  type AudioWorkerEvent,
} from '@vozella/contracts';
import { CancelSource, toMeterPercent, type CaptureSession } from '@vozella/core';
import { createAudioRuntime, type AudioRuntime, type NativePorts } from '@vozella/platform';

export interface AudioWorkerDeps {
  /** Builds the ports on first use, so a missing addon is reported as a message, not a crash. */
  readonly createPorts: () => NativePorts;
  readonly post: (event: AudioWorkerEvent) => void;
  /** The main process of the app, so its helpers stay out of the app list. */
  readonly mainProcessId?: number;
  /** Milliseconds, for the level throttle. Tests pass a fake. */
  readonly nowMs?: () => number;
}

/** Idle preview levels reach the page about ten times a second. */
const PREVIEW_LEVEL_INTERVAL_MS = 100;

/**
 * The audio utilityProcess brain, free of Electron so it can be tested. One capture at a
 * time for the single-source diagnostic; the recording, the preview, the app list and the
 * import run through `rpc`. Every failure becomes a message, never a crash.
 */
/** The main pid the own-tree exclusion needs. Missing or invalid is an error, never 0. */
export function parseMainProcessId(raw: string | undefined): number {
  const pid = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isInteger(pid) || pid <= 0) {
    throw new Error('VOZELLA_MAIN_PID is not set to a valid process id');
  }
  return pid;
}

export function createAudioWorker(deps: AudioWorkerDeps): (raw: unknown) => Promise<void> {
  let ports: NativePorts | undefined;
  let session: CaptureSession | undefined;
  let runtime: AudioRuntime | undefined;
  let importCancel: CancelSource | undefined;
  let lastPreviewAt = Number.NEGATIVE_INFINITY;
  const now = deps.nowMs ?? ((): number => Date.now());

  const getPorts = (): NativePorts => (ports ??= deps.createPorts());

  const getRuntime = (): AudioRuntime =>
    (runtime ??= createAudioRuntime({
      ports: getPorts(),
      ownProcessId: deps.mainProcessId ?? 0,
      onPreviewLevel: (level) => {
        const at = now();
        // A level of zero is the device going away: always let it through.
        if (level !== 0 && at - lastPreviewAt < PREVIEW_LEVEL_INTERVAL_MS) return;
        lastPreviewAt = at;
        deps.post({ type: 'preview-level', level: toMeterPercent(level) });
      },
    }));

  const rpc = async (call: AudioRpcCall): Promise<unknown> => {
    const rt = getRuntime();
    switch (call.method) {
      case 'recordStart':
        rt.recording.setListeners({
          onFrame: (frame) => {
            deps.post({ type: 'recording-frame', pcm: frame.pcm });
          },
          onMicrophoneLevel: (level) => {
            deps.post({ type: 'recording-level', level: toMeterPercent(level) });
          },
          onSourceLost: (e) => {
            deps.post({
              type: 'source-lost',
              source: e.source,
              remaining: e.remaining,
              message: e.error.message,
            });
          },
          onOutputCaptureFailed: (error) => {
            deps.post({ type: 'output-failed', message: error.message });
          },
          onFaulted: (error) => {
            deps.post({ type: 'faulted', message: error.message });
          },
        });
        await rt.recording.start(call.path, call.sources);
        return null;
      case 'recordPause':
        rt.recording.pause();
        return null;
      case 'recordResume':
        rt.recording.resume();
        return null;
      case 'recordStop':
        await rt.recording.stop();
        return null;
      case 'previewStart':
        await rt.preview.start(call.deviceId);
        return null;
      case 'previewStop':
        rt.preview.stop();
        return null;
      case 'listMicrophones':
        return rt.listMicrophones();
      case 'appsRefresh':
        return rt.refreshApps();
      case 'appsPeaks':
        return [...rt.apps.readPeaks()];
      case 'getProcess':
        return getPorts().processes.getProcess(call.processId);
      case 'importAudio': {
        importCancel = new CancelSource();
        try {
          await rt.importAudio(call.source, call.destination, importCancel);
        } finally {
          importCancel = undefined;
        }
        return null;
      }
      case 'importCancel':
        importCancel?.cancel();
        return null;
    }
  };

  const handle = async (command: AudioWorkerCommand): Promise<void> => {
    switch (command.type) {
      case 'ping': {
        const p = getPorts();
        deps.post({ type: 'pong', backend: p.backend, platformSupported: p.platformSupported });
        return;
      }
      case 'rpc': {
        try {
          const result = await rpc(command.call);
          deps.post({ type: 'rpc-result', id: command.id, ok: true, result });
        } catch (error) {
          const code = (error as { code?: unknown }).code;
          deps.post({
            type: 'rpc-result',
            id: command.id,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
            ...(typeof code === 'string' ? { code } : {}),
          });
        }
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
        runtime?.preview.stop();
        await runtime?.recording.stop().catch(() => undefined);
        ports?.sessions.dispose();
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
