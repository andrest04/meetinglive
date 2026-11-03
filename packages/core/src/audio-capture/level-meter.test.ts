import { describe, expect, it } from 'vitest';
import {
  computeBufferRms,
  computeRms,
  normalizeFloat32,
  normalizeInt16Le,
  pcm16ToFloat,
  resolveNormalizerGain,
  toMeterPercent,
  toMeterValue,
} from './level-meter';

describe('toMeterValue', () => {
  it.each([0, 1e-6, 0.0005])('is zero at or below the floor (%s)', (amplitude) => {
    expect(toMeterValue(amplitude)).toBe(0);
  });

  it('reads full scale as 1 and clamps above it', () => {
    expect(toMeterValue(1)).toBe(1);
    expect(toMeterValue(4)).toBe(1);
  });

  it('reads -30 dB as one half', () => {
    expect(toMeterValue(0.0316228)).toBeCloseTo(0.5, 4);
  });

  it('puts typical speech between 0.5 and 0.6', () => {
    const v = toMeterValue(0.05);
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(0.6);
    expect(v).toBeCloseTo(0.566, 3);
  });

  it('treats negative and NaN as zero', () => {
    expect(toMeterValue(-0.5)).toBe(0);
    expect(toMeterValue(Number.NaN)).toBe(0);
  });

  it('never reads lower for a louder input', () => {
    let last = -1;
    for (let a = 0; a <= 1; a += 0.001) {
      const v = toMeterValue(a);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('scales to a percent', () => {
    expect(toMeterPercent(1)).toBe(100);
  });
});

describe('RMS', () => {
  it('computes the root mean square in double precision', () => {
    expect(computeRms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5, 10);
    expect(computeRms([])).toBe(0);
  });

  it('reads float32, int16 and int32 buffers and skips non-finite floats', () => {
    const f = new Float32Array([0.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY]);
    expect(computeBufferRms(new Uint8Array(f.buffer), 'float32')).toBeCloseTo(0.5, 6);
    const i16 = new Int16Array([16384, -16384]);
    expect(computeBufferRms(new Uint8Array(i16.buffer), 'int16')).toBeCloseTo(0.5, 6);
    const i32 = new Int32Array([1_073_741_824, -1_073_741_824]);
    expect(computeBufferRms(new Uint8Array(i32.buffer), 'int32')).toBeCloseTo(0.5, 3);
  });

  it('reads other depths and empty buffers as zero and clamps to 1', () => {
    expect(computeBufferRms(new Uint8Array(12), 'int24')).toBe(0);
    expect(computeBufferRms(new Uint8Array(0), 'int16')).toBe(0);
    const loud = new Float32Array([3, -3]);
    expect(computeBufferRms(new Uint8Array(loud.buffer), 'float32')).toBe(1);
  });

  it('converts PCM16 to float32 with a 32768 divisor', () => {
    const f = pcm16ToFloat(new Uint8Array(new Int16Array([16384, -32768, 32767]).buffer));
    expect([...f]).toEqual([0.5, -1, 32767 / 32768]);
  });
});

describe('level normalizer (kept, not wired in)', () => {
  const int16 = (values: number[]): Uint8Array => new Uint8Array(new Int16Array(values).buffer);
  const read = (b: Uint8Array): number[] => [
    ...new Int16Array(b.buffer, b.byteOffset, b.length / 2),
  ];

  it('leaves silence, quiet noise and loud audio unchanged', () => {
    const silence = int16([0, 0, 0]);
    normalizeInt16Le(silence);
    expect(read(silence)).toEqual([0, 0, 0]);
    const floor = int16([30, -30]); // peak 0.0009, under the silence floor
    normalizeInt16Le(floor);
    expect(read(floor)).toEqual([30, -30]);
    const loud = int16([26000, -26000]);
    normalizeInt16Le(loud);
    expect(read(loud)).toEqual([26000, -26000]);
  });

  it('raises quiet speech toward the target peak', () => {
    const quiet = int16([1000, -2000]);
    normalizeInt16Le(quiet);
    const peak = Math.max(...read(quiet).map(Math.abs));
    expect(peak / 32768).toBeCloseTo(0.7, 2);
  });

  it('caps the gain at 16 and does not overflow int16', () => {
    expect(resolveNormalizerGain(0.01)).toBe(16);
    expect(resolveNormalizerGain(0.003)).toBe(16);
    const samples = int16([200, -200]);
    normalizeInt16Le(samples);
    expect(Math.max(...read(samples).map(Math.abs))).toBeLessThanOrEqual(32767);
  });

  it('applies one gain to a whole float32 utterance', () => {
    const samples = new Float32Array([0.05, -0.1, 0.02]);
    normalizeFloat32(samples);
    expect(Math.max(...samples.map(Math.abs))).toBeCloseTo(0.7, 5);
    expect(samples[0]! / samples[1]!).toBeCloseTo(-0.5, 5);
  });

  it('shows why per chunk normalization pumps the level', () => {
    const a = new Float32Array([0.01, -0.01]);
    const b = new Float32Array([0.2, -0.2]);
    normalizeFloat32(a);
    normalizeFloat32(b);
    // Both chunks end up at different gains even though they were one steady voice.
    expect(Math.abs(a[0]!)).toBeCloseTo(0.16, 5);
    expect(Math.abs(b[0]!)).toBeCloseTo(0.7, 5);
  });
});
