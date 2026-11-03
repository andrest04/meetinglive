import { describe, expect, it } from 'vitest';
import { INSTALL_STAGE_LABEL_KEYS } from './install-labels';
import { pcm16ToFloat32 } from './pcm';

describe('pcm16ToFloat32', () => {
  it('scales little endian samples to -1..1', () => {
    const bytes = new Uint8Array(new Int16Array([0, 16384, -32768, 32767]).buffer);
    const out = pcm16ToFloat32(bytes);
    expect([...out]).toEqual([0, 0.5, -1, 32767 / 32768]);
  });

  it('reads a view that does not start at the buffer start, and drops a trailing odd byte', () => {
    const backing = new Uint8Array([9, 9, 0, 64, 7]);
    expect([...pcm16ToFloat32(backing.subarray(2))]).toEqual([0.5]);
    expect(pcm16ToFloat32(new Uint8Array(0))).toHaveLength(0);
  });
});

describe('install stage labels', () => {
  it('has a catalog key for every stage', () => {
    expect(Object.keys(INSTALL_STAGE_LABEL_KEYS).sort()).toEqual(
      ['model', 'runtime-cpu', 'runtime-cpu-fallback', 'runtime-cuda', 'speaker-model'].sort(),
    );
  });
});
