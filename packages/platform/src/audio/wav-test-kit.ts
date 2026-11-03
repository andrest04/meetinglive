import fs from 'node:fs';

/** A PCM WAV with any format, written the way a recorder would. */
export function writeWav(
  target: string,
  opts: {
    rate: number;
    channels: number;
    bits?: number;
    float?: boolean;
    seconds: number;
    freq?: number;
  },
): void {
  const bits = opts.bits ?? 16;
  const frames = Math.round(opts.rate * opts.seconds);
  const align = (bits / 8) * opts.channels;
  const body = Buffer.alloc(frames * align);
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < opts.channels; c += 1) {
      const v = Math.sin((2 * Math.PI * (opts.freq ?? 440) * f) / opts.rate) * 0.5;
      const at = f * align + c * (bits / 8);
      if (opts.float) body.writeFloatLE(v, at);
      else if (bits === 16) body.writeInt16LE(Math.round(v * 32767), at);
      else body.writeIntLE(Math.round(v * 8_388_607), at, 3);
    }
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + body.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(opts.float ? 3 : 1, 20);
  head.writeUInt16LE(opts.channels, 22);
  head.writeUInt32LE(opts.rate, 24);
  head.writeUInt32LE(opts.rate * align, 28);
  head.writeUInt16LE(align, 32);
  head.writeUInt16LE(bits, 34);
  head.write('data', 36);
  head.writeUInt32LE(body.length, 40);
  fs.writeFileSync(target, Buffer.concat([head, body]));
}
