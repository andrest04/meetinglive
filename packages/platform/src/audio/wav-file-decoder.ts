import fs from 'node:fs';
import type { AudioFileDecoder } from '@vozella/core';

/**
 * Reads a PCM or float WAV as 16 kHz mono PCM16, any channel count and rate. The real app
 * decodes through Media Foundation; this decoder backs the fake native build and tests.
 * Resampling is linear: good enough for a stand-in, not for production audio.
 */
export function openWavFileDecoder(path: string): AudioFileDecoder {
  const fd = fs.openSync(path, 'r');
  try {
    const length = fs.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(length, 4096));
    fs.readSync(fd, head, 0, head.length, 0);
    const fmt = findFormat(head);
    if (!fmt) throw new Error('The file is not a WAV the fallback decoder can read.');
    const declaredEnd = fmt.dataOffset + fmt.dataSize;
    const dataEnd = fmt.dataSize === 0 || declaredEnd > length ? length : declaredEnd;
    return new WavDecoder(fd, fmt, dataEnd);
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

interface WavFormat {
  readonly channels: number;
  readonly sampleRate: number;
  readonly bits: number;
  readonly isFloat: boolean;
  readonly dataOffset: number;
  readonly dataSize: number;
}

function findFormat(head: Buffer): WavFormat | undefined {
  if (head.length < 12 || head.toString('ascii', 0, 4) !== 'RIFF') return undefined;
  let offset = 12;
  let fmt: Omit<WavFormat, 'dataOffset' | 'dataSize'> | undefined;
  while (offset + 8 <= head.length) {
    const id = head.toString('ascii', offset, offset + 4);
    const size = head.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 24 <= head.length) {
      const tag = head.readUInt16LE(offset + 8);
      if (tag !== 1 && tag !== 3) return undefined;
      fmt = {
        isFloat: tag === 3,
        channels: head.readUInt16LE(offset + 10),
        sampleRate: head.readUInt32LE(offset + 12),
        bits: head.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      return fmt ? { ...fmt, dataOffset: offset + 8, dataSize: size } : undefined;
    }
    offset += 8 + size + (size & 1);
  }
  return undefined;
}

const CHUNK_OUTPUT_FRAMES = 16_000;

class WavDecoder implements AudioFileDecoder {
  private position: number;
  /** Fractional source position carried between chunks. */
  private carry = 0;
  private closed = false;

  constructor(
    private readonly fd: number,
    private readonly fmt: WavFormat,
    private readonly dataEnd: number,
  ) {
    this.position = fmt.dataOffset;
  }

  read(): Uint8Array | null {
    const bytesPerSample = this.fmt.bits / 8;
    const bytesPerFrame = bytesPerSample * this.fmt.channels;
    const remaining = this.dataEnd - this.position;
    if (this.closed || remaining < bytesPerFrame) return null;
    const wanted = Math.ceil((CHUNK_OUTPUT_FRAMES * this.fmt.sampleRate) / 16_000);
    const sourceFrames = Math.max(1, Math.min(Math.floor(remaining / bytesPerFrame), wanted));
    const buffer = Buffer.alloc(sourceFrames * bytesPerFrame);
    fs.readSync(this.fd, buffer, 0, buffer.length, this.position);
    this.position += buffer.length;

    const mono = new Float32Array(sourceFrames);
    for (let f = 0; f < sourceFrames; f += 1) {
      let sum = 0;
      for (let c = 0; c < this.fmt.channels; c += 1) {
        sum += this.sample(buffer, (f * this.fmt.channels + c) * bytesPerSample);
      }
      mono[f] = sum / this.fmt.channels;
    }

    const step = this.fmt.sampleRate / 16_000;
    const out: number[] = [];
    let pos = this.carry;
    while (pos < sourceFrames) {
      const i = Math.floor(pos);
      const a = mono[i] ?? 0;
      const b = mono[i + 1] ?? a;
      out.push(a + (b - a) * (pos - i));
      pos += step;
    }
    this.carry = pos - sourceFrames;

    const pcm = new Uint8Array(out.length * 2);
    const view = new DataView(pcm.buffer);
    out.forEach((v, i) => {
      view.setInt16(i * 2, Math.round(Math.min(1, Math.max(-1, v)) * 32767), true);
    });
    return pcm;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    fs.closeSync(this.fd);
  }

  private sample(b: Buffer, at: number): number {
    if (this.fmt.isFloat) return b.readFloatLE(at);
    switch (this.fmt.bits) {
      case 8:
        return (b.readUInt8(at) - 128) / 128;
      case 16:
        return b.readInt16LE(at) / 32768;
      case 24:
        return b.readIntLE(at, 3) / 8_388_608;
      default:
        return b.readInt32LE(at) / 2_147_483_648;
    }
  }
}
