import { describe, expect, it } from 'vitest';
import {
  assertProcessLoopbackSupported,
  PROCESS_LOOPBACK_MIN_BUILD,
  ProcessLoopbackUnsupportedError,
} from './ports';

describe('assertProcessLoopbackSupported (C7)', () => {
  it('lets Windows 10 version 2004 and later through, and an unknown build', () => {
    expect(() => assertProcessLoopbackSupported(19_041)).not.toThrow();
    expect(() => assertProcessLoopbackSupported(19_045)).not.toThrow();
    expect(() => assertProcessLoopbackSupported(0)).not.toThrow();
  });

  it('refuses a build before the API existed, naming a real Windows 10 version', () => {
    expect(() => assertProcessLoopbackSupported(PROCESS_LOOPBACK_MIN_BUILD - 1)).toThrow(
      ProcessLoopbackUnsupportedError,
    );
    expect(() => assertProcessLoopbackSupported(18_363)).toThrow(/Windows 10 version 2004/);
  });
});
