import type { MicrophoneDevice } from './record-sources';

/** Port: the active capture endpoints (spec 3.1.5). Adapter: the native addon. */
export interface MicrophoneDeviceSource {
  /** Active capture endpoints. An endpoint that cannot be read is left out, not fatal. */
  list(): MicrophoneDevice[];
}

/** Port: the Windows build number, for capability checks. Zero when unknown. */
export interface OsBuildProbe {
  windowsBuild(): number;
}

/** Process loopback needs the build where Microsoft documents the API (spec bug C7). */
export const PROCESS_LOOPBACK_MIN_BUILD = 20348;

export class ProcessLoopbackUnsupportedError extends Error {
  readonly code = 'process-loopback-unsupported';
  constructor(readonly build: number) {
    super(
      `Recording a single app needs Windows 10 build ${PROCESS_LOOPBACK_MIN_BUILD} or later. This PC runs build ${build}. Record all system audio instead.`,
    );
    this.name = 'ProcessLoopbackUnsupportedError';
  }
}

/** Throws a clear error where the raw HRESULT of a failed activation would have shown (C7). */
export function assertProcessLoopbackSupported(build: number): void {
  // An unknown build (0) is allowed through: the activation error then speaks for itself.
  if (build > 0 && build < PROCESS_LOOPBACK_MIN_BUILD) {
    throw new ProcessLoopbackUnsupportedError(build);
  }
}
