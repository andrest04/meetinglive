import fs from 'node:fs';
import {
  analyzeWav,
  buildWavHeader,
  readWavInfo,
  WAV_DATA_SIZE_OFFSET,
  WAV_HEADER_BYTES,
  WAV_RIFF_SIZE_OFFSET,
  type ByteSource,
  type WavAnalysis,
  type WavInfo,
  type WavRepairStatus,
  type WavWriter,
} from '@vozella/core';

function writeSizes(fd: number, riffSize: number, dataSize: number, dataSizeOffset: number): void {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, riffSize, true);
  fs.writeSync(fd, bytes, 0, 4, WAV_RIFF_SIZE_OFFSET);
  view.setUint32(0, dataSize, true);
  fs.writeSync(fd, bytes, 0, 4, dataSizeOffset);
}

/** The 16 kHz mono PCM16 WAV of the app, written in place with its header kept current. */
export class WavFileWriter implements WavWriter {
  private fd: number | undefined;
  private dataBytes = 0;

  constructor(readonly path: string) {
    const fd = fs.openSync(path, 'w+');
    try {
      fs.writeSync(fd, buildWavHeader(0), 0, WAV_HEADER_BYTES, 0);
    } catch (error) {
      fs.closeSync(fd);
      throw error;
    }
    this.fd = fd;
  }

  write(pcm: Uint8Array): void {
    const fd = this.open();
    fs.writeSync(fd, pcm, 0, pcm.byteLength, WAV_HEADER_BYTES + this.dataBytes);
    this.dataBytes += pcm.byteLength;
  }

  /** Rewrites the RIFF and data sizes. Audio positions are explicit, so nothing to restore. */
  flush(): void {
    writeSizes(
      this.open(),
      WAV_HEADER_BYTES - 8 + this.dataBytes,
      this.dataBytes,
      WAV_DATA_SIZE_OFFSET,
    );
  }

  close(): void {
    const fd = this.fd;
    if (fd === undefined) return;
    this.fd = undefined;
    try {
      writeSizes(fd, WAV_HEADER_BYTES - 8 + this.dataBytes, this.dataBytes, WAV_DATA_SIZE_OFFSET);
    } finally {
      fs.closeSync(fd);
    }
  }

  private open(): number {
    if (this.fd === undefined) throw new Error('The WAV file is closed.');
    return this.fd;
  }
}

function fileSource(fd: number, length: number): ByteSource {
  return {
    length,
    read: (offset, count) => {
      const buffer = Buffer.alloc(count);
      const read = fs.readSync(fd, buffer, 0, count, offset);
      return buffer.subarray(0, read);
    },
  };
}

function requirePath(path: string): void {
  if (path.trim() === '') throw new Error('The WAV path is empty.');
}

/**
 * Fixes the RIFF and data sizes of a WAV a crash left at zero (spec 3.6). Never touches a
 * consistent file, never truncates audio, never throws for I/O errors.
 */
export function repairWavFile(path: string): WavRepairStatus {
  requirePath(path);
  try {
    const { analysis, length } = analyzeFile(path);
    if (analysis.status !== 'NeedsRepair') return analysis.status;
    const writer = fs.openSync(path, 'r+');
    try {
      if (fs.fstatSync(writer).size !== length) return 'Failed';
      writeSizes(writer, analysis.riffSize, analysis.dataSize, analysis.dataSizeOffset);
      fs.fsyncSync(writer);
    } finally {
      fs.closeSync(writer);
    }
    return 'Repaired';
  } catch {
    return 'Failed';
  }
}

function analyzeFile(path: string): { analysis: WavAnalysis; length: number } {
  const fd = fs.openSync(path, 'r');
  try {
    const length = fs.fstatSync(fd).size;
    return { analysis: analyzeWav(fileSource(fd, length)), length };
  } finally {
    fs.closeSync(fd);
  }
}

/** Format and length of a consistent WAV. Does not repair: a file with zero sizes throws. */
export function readWavFileInfo(path: string): WavInfo {
  requirePath(path);
  const fd = fs.openSync(path, 'r');
  try {
    return readWavInfo(fileSource(fd, fs.fstatSync(fd).size));
  } finally {
    fs.closeSync(fd);
  }
}

export function readWavDurationSeconds(path: string): number {
  return readWavFileInfo(path).seconds;
}
