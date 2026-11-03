/** 16-bit little-endian PCM to float samples in -1..1, the form the engine takes (spec 3.1). */
export function pcm16ToFloat32(pcm: Uint8Array): Float32Array {
  const samples = Math.floor(pcm.byteLength / 2);
  const out = new Float32Array(samples);
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
  for (let i = 0; i < samples; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}
