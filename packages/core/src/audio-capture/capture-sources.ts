/** What one recording captures (spec 2.2.1): an optional microphone and exactly one output. */

export type OutputKind = 'SystemLoopback' | 'ProcessTree';

export interface RecordingCaptureSources {
  readonly captureMicrophone: boolean;
  /** Null or empty with `captureMicrophone` true means the OS default input. */
  readonly microphoneDeviceId: string | null;
  readonly output: OutputKind;
  /** The root process of the captured app. Zero for system loopback. */
  readonly processId: number;
}

/** A request that breaks a rule of the capture request. `param` names the offending field. */
export class CaptureSourcesError extends Error {
  constructor(
    message: string,
    readonly param: 'output' | 'processId',
    readonly kind: 'argument' | 'out-of-range',
  ) {
    super(message);
    this.name = 'CaptureSourcesError';
  }
}

/** Throws unless the request names exactly one valid output. Called at the top of Start too. */
export function assertValidCaptureSources(sources: RecordingCaptureSources): void {
  const output: string = sources.output;
  if (output !== 'SystemLoopback' && output !== 'ProcessTree') {
    throw new CaptureSourcesError(
      'Output must be exactly system loopback or one process tree.',
      'output',
      'argument',
    );
  }
  if (output === 'ProcessTree' && sources.processId === 0) {
    throw new CaptureSourcesError(
      'Process id 0 is not a valid capture target.',
      'processId',
      'out-of-range',
    );
  }
  if (output === 'SystemLoopback' && sources.processId !== 0) {
    throw new CaptureSourcesError(
      'System loopback cannot also target a process.',
      'processId',
      'argument',
    );
  }
}

export function systemLoopbackSources(
  captureMicrophone: boolean,
  microphoneDeviceId: string | null = null,
): RecordingCaptureSources {
  const sources: RecordingCaptureSources = {
    captureMicrophone,
    microphoneDeviceId,
    output: 'SystemLoopback',
    processId: 0,
  };
  assertValidCaptureSources(sources);
  return sources;
}

export function processTreeSources(
  captureMicrophone: boolean,
  microphoneDeviceId: string | null,
  processId: number,
): RecordingCaptureSources {
  const sources: RecordingCaptureSources = {
    captureMicrophone,
    microphoneDeviceId,
    output: 'ProcessTree',
    processId,
  };
  assertValidCaptureSources(sources);
  return sources;
}

export function usesSystemLoopback(sources: RecordingCaptureSources): boolean {
  return sources.output === 'SystemLoopback';
}

/** The legacy `Start(path, deviceId)` overload: system loopback with the microphone on. */
export function legacyCaptureSources(
  microphoneDeviceId: string | null = null,
): RecordingCaptureSources {
  return systemLoopbackSources(true, microphoneDeviceId);
}

/** The id the capture should open: only when the microphone is on and an id was given. */
export function effectiveMicrophoneId(sources: RecordingCaptureSources): string | null {
  if (!sources.captureMicrophone) return null;
  return sources.microphoneDeviceId !== null && sources.microphoneDeviceId !== ''
    ? sources.microphoneDeviceId
    : null;
}

/** Spec 2.3.3. A failure counts as a lost source only if it is an error and not a user stop. */
export function isSourceLost(error: Error | null | undefined, userStop: boolean): boolean {
  return error != null && !userStop;
}

/** Spec 2.3.3. Only a process capture ends the recording on its own failure. */
export function shouldSurfaceOutputFailure(
  error: Error | null | undefined,
  userStop: boolean,
  isProcessCapture: boolean,
): boolean {
  return error != null && !userStop && isProcessCapture;
}
