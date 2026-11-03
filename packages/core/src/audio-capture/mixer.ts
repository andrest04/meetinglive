/** Mixing of the 16 kHz mono sources into one stream (spec 2.2.3, 3.1.1). */

export const SOURCE_BUFFER_SECONDS = 5;
export const SOURCE_BUFFER_SAMPLES = 16_000 * SOURCE_BUFFER_SECONDS;

/** One source's buffer: drops new data when full, reads zeros when it runs dry. */
export class MixerInput {
  private readonly ring = new Float32Array(SOURCE_BUFFER_SAMPLES);
  private head = 0;
  private count = 0;

  /** Appends PCM16 little-endian samples. Samples that do not fit are dropped. */
  push(pcm: Uint8Array): void {
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const samples = Math.floor(pcm.byteLength / 2);
    for (let i = 0; i < samples; i += 1) {
      if (this.count === this.ring.length) return;
      this.ring[(this.head + this.count) % this.ring.length] = view.getInt16(i * 2, true) / 32767;
      this.count += 1;
    }
  }

  /** Adds up to `into.length` samples to `into`; a short buffer leaves the rest untouched. */
  addTo(into: Float32Array): void {
    const n = Math.min(into.length, this.count);
    for (let i = 0; i < n; i += 1) {
      into[i] = (into[i] ?? 0) + (this.ring[(this.head + i) % this.ring.length] ?? 0);
    }
    this.head = (this.head + n) % this.ring.length;
    this.count -= n;
  }

  get buffered(): number {
    return this.count;
  }
}

/** Sums its inputs with no attenuation and converts to PCM16: clamp to [-1, 1], x32767. */
export class AudioMixer {
  private readonly inputs: MixerInput[] = [];

  addInput(): MixerInput {
    const input = new MixerInput();
    this.inputs.push(input);
    return input;
  }

  /** Always returns `sampleCount` samples; silence where no source delivered. */
  read(sampleCount: number): Uint8Array {
    const sum = new Float32Array(sampleCount);
    for (const input of this.inputs) input.addTo(sum);
    const out = new Uint8Array(sampleCount * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < sampleCount; i += 1) {
      const clamped = Math.min(1, Math.max(-1, sum[i] ?? 0));
      view.setInt16(i * 2, Math.round(clamped * 32767), true);
    }
    return out;
  }
}

/**
 * Averages interleaved channels to mono, any channel count (fixes C2 and C3). One channel
 * passes through; two use weights 0.5 and 0.5.
 */
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += interleaved[f * channels + c] ?? 0;
    out[f] = sum / channels;
  }
  return out;
}
