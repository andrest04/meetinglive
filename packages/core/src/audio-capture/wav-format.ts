/** WAV file rules (spec 3.6, 4.1, 2.2.5, 2.9). Pure: reads go through a byte reader. */

export const MIX_SAMPLE_RATE = 16_000;
export const FILE_BYTES_PER_SECOND = 32_000;
/** The app's own header: a 18-byte fmt chunk (cbSize 0), so audio starts at offset 46. */
export const WAV_HEADER_BYTES = 46;
export const WAV_DATA_SIZE_OFFSET = 42;
export const WAV_RIFF_SIZE_OFFSET = 4;

/** The 46-byte header of 16 kHz mono PCM16 with both sizes zero, as a crashed file has it. */
export function buildWavHeader(dataSize = 0): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) bytes[offset + i] = text.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, dataSize === 0 ? 0 : WAV_HEADER_BYTES - 8 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 18, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, MIX_SAMPLE_RATE, true);
  view.setUint32(28, FILE_BYTES_PER_SECOND, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true);
  view.setUint16(36, 0, true); // cbSize
  ascii(38, 'data');
  view.setUint32(42, dataSize, true);
  return bytes;
}

/** Header-flush cadence (spec 2.2.5): fires once per interval of written bytes. */
export class WavHeaderFlushCadence {
  private lastFlushBytes = 0;

  constructor(private readonly intervalBytes: number) {
    if (!(intervalBytes > 0)) {
      throw new RangeError('The flush interval must be greater than zero.');
    }
  }

  static forFormat(bytesPerSecond: number, seconds: number): WavHeaderFlushCadence {
    return new WavHeaderFlushCadence(bytesPerSecond * seconds);
  }

  shouldFlush(totalBytes: number): boolean {
    if (totalBytes - this.lastFlushBytes < this.intervalBytes) return false;
    this.lastFlushBytes = totalBytes;
    return true;
  }
}

export type WavRepairStatus = 'Valid' | 'Repaired' | 'NotWav' | 'Unsupported' | 'Failed';

/** Random-access bytes of a file. `read` may return fewer bytes at the end. */
export interface ByteSource {
  readonly length: number;
  read(offset: number, count: number): Uint8Array;
}

export type WavAnalysis =
  | { readonly status: 'Valid' | 'NotWav' | 'Unsupported' }
  | {
      readonly status: 'NeedsRepair';
      readonly riffSize: number;
      readonly dataSize: number;
      readonly dataSizeOffset: number;
    };

const UINT32_MAX = 0xffff_ffff;

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}
function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}
function tag(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/** Read-only analysis of a WAV whose sizes may never have been written (spec 3.6). */
export function analyzeWav(file: ByteSource): WavAnalysis {
  const length = file.length;
  if (length > UINT32_MAX) return { status: 'Unsupported' };
  const head = file.read(0, 12);
  if (head.length < 12 || tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') {
    return { status: 'NotWav' };
  }
  const riffSize = u32(head, 4);

  let blockAlign = 0;
  let offset = 12;
  let found: { dataOffset: number; dataSizeOffset: number; dataSize: number } | undefined;
  while (offset + 8 <= length) {
    const header = file.read(offset, 8);
    if (header.length < 8) break;
    const id = tag(header, 0);
    const size = u32(header, 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      if (size < 16) return { status: 'NotWav' };
      const fmt = file.read(body, 16);
      if (fmt.length < 16) return { status: 'NotWav' };
      const formatTag = u16(fmt, 0);
      const align = u16(fmt, 12);
      if ((formatTag !== 1 && formatTag !== 3) || align === 0) return { status: 'Unsupported' };
      blockAlign = align;
    } else if (id === 'data') {
      if (blockAlign === 0) return { status: 'NotWav' };
      found = { dataOffset: body, dataSizeOffset: offset + 4, dataSize: size };
      break;
    }
    const next = body + size + (size & 1);
    if (next >= length) break;
    offset = next;
  }
  if (!found) return { status: 'NotWav' };

  const available = length - found.dataOffset;
  if (available < 0) return { status: 'NotWav' };
  const dataBroken =
    (found.dataSize === 0 && available >= blockAlign) || found.dataOffset + found.dataSize > length;
  const riffBroken = riffSize === 0 || riffSize + 8 > length;
  if (!dataBroken && !riffBroken) return { status: 'Valid' };

  const newData = dataBroken ? available - (available % blockAlign) : found.dataSize;
  const endOfAudio = dataBroken ? found.dataOffset + newData : length;
  return {
    status: 'NeedsRepair',
    riffSize: endOfAudio - 8,
    dataSize: newData,
    dataSizeOffset: found.dataSizeOffset,
  };
}

export interface WavInfo {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly dataBytes: number;
  readonly seconds: number;
}

/**
 * Reads the format and the length of a consistent WAV (spec 2.9). It does not repair:
 * a file whose sizes are zero throws.
 */
export function readWavInfo(file: ByteSource): WavInfo {
  const head = file.read(0, 12);
  if (head.length < 12 || tag(head, 0) !== 'RIFF' || tag(head, 8) !== 'WAVE') {
    throw new Error('The file is not a WAV file.');
  }
  let offset = 12;
  let fmt: { sampleRate: number; channels: number; bits: number; align: number } | undefined;
  while (offset + 8 <= file.length) {
    const header = file.read(offset, 8);
    if (header.length < 8) break;
    const id = tag(header, 0);
    const size = u32(header, 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      const bytes = file.read(body, 16);
      if (bytes.length < 16) throw new Error('The WAV header is damaged.');
      fmt = {
        channels: u16(bytes, 2),
        sampleRate: u32(bytes, 4),
        align: u16(bytes, 12),
        bits: u16(bytes, 14),
      };
    } else if (id === 'data') {
      if (!fmt || fmt.align === 0) throw new Error('The WAV header is damaged.');
      if (size === 0 || body + size > file.length) {
        throw new Error('The WAV file has no valid length.');
      }
      const frames = Math.floor(size / fmt.align);
      return {
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        bitsPerSample: fmt.bits,
        dataBytes: size,
        seconds: frames / fmt.sampleRate,
      };
    }
    offset = body + size + (size & 1);
  }
  throw new Error('The WAV file has no audio data.');
}
