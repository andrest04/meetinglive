import { describe, expect, it } from 'vitest';
import { AudioMixer, SOURCE_BUFFER_SAMPLES } from './mixer';

function pcm(...values: number[]): Uint8Array {
  return new Uint8Array(new Int16Array(values).buffer);
}
function out(bytes: Uint8Array): number[] {
  return [...new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)];
}

describe('AudioMixer', () => {
  it('returns the requested length of silence with no input data', () => {
    const m = new AudioMixer();
    m.addInput();
    expect(out(m.read(4))).toEqual([0, 0, 0, 0]);
  });

  it('passes one source through unchanged', () => {
    const m = new AudioMixer();
    const a = m.addInput();
    a.push(pcm(0, 1, -1, 12345, -32767, 32767));
    expect(out(m.read(6))).toEqual([0, 1, -1, 12345, -32767, 32767]);
  });

  it('sums sources with no attenuation and clamps', () => {
    const m = new AudioMixer();
    const a = m.addInput();
    const b = m.addInput();
    a.push(pcm(1000, 30000, -30000));
    b.push(pcm(2000, 30000, -30000));
    expect(out(m.read(3))).toEqual([3000, 32767, -32767]);
  });

  it('pads a short source with zeros mid-stream', () => {
    const m = new AudioMixer();
    const a = m.addInput();
    const b = m.addInput();
    a.push(pcm(100, 100, 100, 100));
    b.push(pcm(50));
    expect(out(m.read(4))).toEqual([150, 100, 100, 100]);
  });

  it('drops new data when the 5 second buffer is full', () => {
    const m = new AudioMixer();
    const a = m.addInput();
    const chunk = new Int16Array(SOURCE_BUFFER_SAMPLES).fill(7);
    a.push(new Uint8Array(chunk.buffer));
    a.push(pcm(99, 99, 99));
    expect(a.buffered).toBe(SOURCE_BUFFER_SAMPLES);
    const all = out(m.read(SOURCE_BUFFER_SAMPLES + 3));
    expect(all[SOURCE_BUFFER_SAMPLES - 1]).toBe(7);
    expect(all.slice(SOURCE_BUFFER_SAMPLES)).toEqual([0, 0, 0]);
  });
});
