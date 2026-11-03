import { describe, expect, it } from 'vitest';
import { captureNotice, chooseWarning, firstFailure, isHardFailure } from './capture-notices';

describe('captureNotice severity (B-12)', () => {
  it('output failure and faulted pump are errors, with the message as the argument', () => {
    const out = captureNotice({ kind: 'output-failed', message: 'gone' });
    const fault = captureNotice({ kind: 'faulted', message: 'disk full' });
    expect(out).toEqual({ severity: 'error', key: 'Error_OutputCaptureFailed', args: ['gone'] });
    expect(fault).toEqual({ severity: 'error', key: 'Error_CaptureFaulted', args: ['disk full'] });
    expect(isHardFailure(out) && isHardFailure(fault)).toBe(true);
  });
  it('lost sources are warnings; an empty mix is the nothing-left warning', () => {
    const mic = captureNotice({ kind: 'source-lost', source: 'Microphone', remaining: 1 });
    const out = captureNotice({ kind: 'source-lost', source: 'Output', remaining: 1 });
    const none = captureNotice({ kind: 'source-lost', source: 'Output', remaining: 0 });
    expect([mic.key, out.key, none.key]).toEqual([
      'Warning_MicrophoneLost',
      'Warning_OutputAudioLost',
      'Warning_NoAudioSourcesLeft',
    ]);
    expect([mic, out, none].every((n) => n.severity === 'warning')).toBe(true);
    expect(isHardFailure(mic)).toBe(false);
  });
});

describe('precedence', () => {
  const mic = captureNotice({ kind: 'source-lost', source: 'Microphone', remaining: 1 });
  const none = captureNotice({ kind: 'source-lost', source: 'Output', remaining: 0 });
  it('nothing left outranks later warnings', () => {
    expect(chooseWarning(none, mic)).toBe(none);
    expect(chooseWarning(null, mic)).toBe(mic);
    expect(chooseWarning(mic, none)).toBe(none);
  });
  it('only the first hard failure of a take is handled', () => {
    const e1 = captureNotice({ kind: 'faulted', message: 'a' });
    const e2 = captureNotice({ kind: 'output-failed', message: 'b' });
    expect(firstFailure(null, e1)).toBe(e1);
    expect(firstFailure(e1, e2)).toBeNull();
    expect(firstFailure(null, mic)).toBeNull();
  });
});
