import { describe, expect, it } from 'vitest';
import {
  assertValidCaptureSources,
  CaptureSourcesError,
  effectiveMicrophoneId,
  isSourceLost,
  legacyCaptureSources,
  processTreeSources,
  shouldSurfaceOutputFailure,
  systemLoopbackSources,
  usesSystemLoopback,
  type RecordingCaptureSources,
} from './capture-sources';

describe('RecordingCaptureSources', () => {
  it('system loopback with a device id keeps the microphone and needs no process id', () => {
    const s = systemLoopbackSources(true, 'dev');
    expect(s).toEqual({
      captureMicrophone: true,
      microphoneDeviceId: 'dev',
      output: 'SystemLoopback',
      processId: 0,
    });
    expect(usesSystemLoopback(s)).toBe(true);
  });

  it('microphone off is distinct from a null device id', () => {
    expect(effectiveMicrophoneId(systemLoopbackSources(false, 'dev'))).toBeNull();
    expect(effectiveMicrophoneId(systemLoopbackSources(true, null))).toBeNull();
    expect(effectiveMicrophoneId(systemLoopbackSources(true, ''))).toBeNull();
    expect(effectiveMicrophoneId(systemLoopbackSources(true, 'dev'))).toBe('dev');
    expect(systemLoopbackSources(false, null).captureMicrophone).toBe(false);
  });

  it('process tree with pid 0 is out of range', () => {
    let caught: unknown;
    try {
      processTreeSources(true, null, 0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CaptureSourcesError);
    expect(caught).toMatchObject({
      message: 'Process id 0 is not a valid capture target.',
      param: 'processId',
      kind: 'out-of-range',
    });
  });

  it('process tree with a pid does not use system loopback', () => {
    expect(usesSystemLoopback(processTreeSources(false, null, 4242))).toBe(false);
  });

  it('system loopback with a process id is rejected', () => {
    const bad: RecordingCaptureSources = {
      captureMicrophone: true,
      microphoneDeviceId: null,
      output: 'SystemLoopback',
      processId: 7,
    };
    expect(() => assertValidCaptureSources(bad)).toThrow(
      'System loopback cannot also target a process.',
    );
  });

  it('an undefined output kind is rejected', () => {
    const bad = {
      captureMicrophone: true,
      microphoneDeviceId: null,
      output: 'Both',
      processId: 0,
    } as unknown as RecordingCaptureSources;
    expect(() => assertValidCaptureSources(bad)).toThrow(CaptureSourcesError);
    expect(() => assertValidCaptureSources(bad)).toThrow(
      'Output must be exactly system loopback or one process tree.',
    );
  });

  it('the legacy overload is system loopback with the microphone on', () => {
    expect(legacyCaptureSources('x')).toEqual(systemLoopbackSources(true, 'x'));
  });
});

describe('failure predicates', () => {
  const error = new Error('x');
  it('source lost needs an error and no user stop', () => {
    expect(isSourceLost(error, false)).toBe(true);
    expect(isSourceLost(error, true)).toBe(false);
    expect(isSourceLost(null, false)).toBe(false);
    expect(isSourceLost(undefined, false)).toBe(false);
  });

  it('a process output failure surfaces only with an error, no user stop and a process capture', () => {
    expect(shouldSurfaceOutputFailure(error, false, true)).toBe(true);
    expect(shouldSurfaceOutputFailure(null, false, true)).toBe(false);
    expect(shouldSurfaceOutputFailure(error, true, true)).toBe(false);
    expect(shouldSurfaceOutputFailure(error, false, false)).toBe(false);
  });
});
