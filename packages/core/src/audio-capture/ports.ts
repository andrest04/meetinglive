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

/**
 * Process loopback first shipped in Windows 10 version 2004 (build 19041), and the C# app,
 * which does not gate, records one app there today. Older builds get the clear message (spec
 * bug C7). Microsoft's page names 20348; the lower bound is the one that keeps Windows 10 working.
 */
export const PROCESS_LOOPBACK_MIN_BUILD = 19041;

export class ProcessLoopbackUnsupportedError extends Error {
  readonly code = 'process-loopback-unsupported';
  constructor(readonly build: number) {
    super(
      `Recording a single app needs Windows 10 version 2004 (build ${PROCESS_LOOPBACK_MIN_BUILD}) or later. This PC runs build ${build}. Record all system audio instead.`,
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
