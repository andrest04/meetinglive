import fs from 'node:fs';
import type { AudioFrameReader, AudioFrameSource } from '@vozella/core';
import { repairWavFile } from '../audio/wav-files';

interface WavLayout {
  readonly format: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly bits: number;
  readonly dataOffset: number;
  readonly dataBytes: number;
}

/** Walks the RIFF chunks (any fmt size) and finds the audio. A data size of 0 or past the end means "to the end". */
export function readWavLayout(fd: number, fileSize: number): WavLayout {
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, 12, 0);
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('The file is not a WAV file.');
  }
  let position = 12;
  let fmt: Omit<WavLayout, 'dataOffset' | 'dataBytes'> | null = null;
  const chunkHeader = Buffer.alloc(8);
  while (position + 8 <= fileSize) {
    fs.readSync(fd, chunkHeader, 0, 8, position);
    const id = chunkHeader.toString('ascii', 0, 4);
    const size = chunkHeader.readUInt32LE(4);
    const body = position + 8;
    if (id === 'fmt ') {
      const fmtBytes = Buffer.alloc(16);
      fs.readSync(fd, fmtBytes, 0, 16, body);
      fmt = {
        format: fmtBytes.readUInt16LE(0),
        channels: fmtBytes.readUInt16LE(2),
        sampleRate: fmtBytes.readUInt32LE(4),
        bits: fmtBytes.readUInt16LE(14),
      };
    } else if (id === 'data') {
      if (fmt === null) throw new Error('The WAV file has no fmt chunk before its data.');
      const available = fileSize - body;
      const dataBytes = size === 0 || size > available ? available : size;
      return { ...fmt, dataOffset: body, dataBytes };
    }
    position = body + size + (size & 1);
  }
  throw new Error('The WAV file has no audio data.');
}

const supported = (layout: WavLayout): boolean =>
  layout.channels >= 1 &&
  layout.sampleRate > 0 &&
  ((layout.format === 1 && layout.bits === 16) || (layout.format === 3 && layout.bits === 32));

/**
 * Reads a WAV as float samples, a buffer at a time. The header is repaired first when a crash
 * left the sizes at zero (spec 3.1). PCM16 and float32 are supported; the app writes PCM16.
 */
export class WavFrameReader implements AudioFrameReader {
  open(path: string): AudioFrameSource {
    repairWavFile(path);
    const fd = fs.openSync(path, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const layout = readWavLayout(fd, size);
      if (!supported(layout)) {
        throw new Error(
          `Unsupported WAV format (code ${String(layout.format)}, ${String(layout.bits)} bits).`,
        );
      }
      return new FileSource(fd, layout);
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
  }
}

class FileSource implements AudioFrameSource {
  private offset = 0;
  private closed = false;
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationMs: number;
  private readonly bytesPerSample: number;

  constructor(
    private readonly fd: number,
    private readonly layout: WavLayout,
  ) {
    this.sampleRate = layout.sampleRate;
    this.channels = layout.channels;
    this.bytesPerSample = layout.bits / 8;
    const frames = Math.floor(layout.dataBytes / (this.bytesPerSample * layout.channels));
    this.durationMs = (frames / layout.sampleRate) * 1000;
  }

  read(buffer: Float32Array): number {
    if (this.closed) return 0;
    const remaining = this.layout.dataBytes - this.offset;
    const wanted = Math.min(buffer.length, Math.floor(remaining / this.bytesPerSample));
    if (wanted <= 0) return 0;
    const bytes = Buffer.alloc(wanted * this.bytesPerSample);
    const got = fs.readSync(this.fd, bytes, 0, bytes.length, this.layout.dataOffset + this.offset);
    const samples = Math.floor(got / this.bytesPerSample);
    this.offset += samples * this.bytesPerSample;
    if (this.layout.format === 3) {
      for (let i = 0; i < samples; i += 1) buffer[i] = bytes.readFloatLE(i * 4);
    } else {
      for (let i = 0; i < samples; i += 1) buffer[i] = bytes.readInt16LE(i * 2) / 32768;
    }
    return samples;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    fs.closeSync(this.fd);
  }
}
