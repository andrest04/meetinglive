import { describe, expect, it } from 'vitest';
import {
  analyzeWav,
  buildWavHeader,
  readWavInfo,
  WavHeaderFlushCadence,
  WAV_HEADER_BYTES,
  type ByteSource,
} from './wav-format';

function source(bytes: Uint8Array): ByteSource {
  return {
    length: bytes.length,
    read: (offset, count) => bytes.subarray(offset, Math.min(bytes.length, offset + count)),
  };
}

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function audio(n: number): Uint8Array {
  return new Uint8Array(n).map((_, i) => (i % 250) + 1);
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
}

/** A 44-byte-header PCM16 mono file with the given sizes. */
function plain(riff: number, data: number, body: Uint8Array): Uint8Array {
  const fmt = new Uint8Array(16);
  const v = new DataView(fmt.buffer);
  v.setUint16(0, 1, true);
  v.setUint16(2, 1, true);
  v.setUint32(4, 16000, true);
  v.setUint32(8, 32000, true);
  v.setUint16(12, 2, true);
  v.setUint16(14, 16, true);
  return cat(
    ascii('RIFF'),
    u32(riff),
    ascii('WAVE'),
    ascii('fmt '),
    u32(16),
    fmt,
    ascii('data'),
    u32(data),
    body,
  );
}

describe('analyzeWav', () => {
  it('reports a consistent file as valid', () => {
    const body = audio(100);
    expect(analyzeWav(source(plain(36 + 100, 100, body))).status).toBe('Valid');
  });

  it('repairs zero sizes on the app layout (18 byte fmt, audio at 46)', () => {
    const body = audio(1000);
    const file = cat(buildWavHeader(0), body);
    const result = analyzeWav(source(file));
    expect(result).toEqual({
      status: 'NeedsRepair',
      riffSize: 46 + 1000 - 8,
      dataSize: 1000,
      dataSizeOffset: 42,
    });
  });

  it('rounds the data size down to whole frames and ends the RIFF there', () => {
    const file = cat(plain(0, 0, audio(101)));
    expect(analyzeWav(source(file))).toEqual({
      status: 'NeedsRepair',
      riffSize: 44 + 100 - 8,
      dataSize: 100,
      dataSizeOffset: 40,
    });
  });

  it('S10, known limit: a chunk after a zero-size data chunk is counted as audio', () => {
    // Repair cannot tell where audio ends when the size is lost. The app writes no trailing
    // chunks; a foreign WAV with one is repaired as if the chunk were audio.
    const trailing = cat(ascii('LIST'), u32(4), ascii('abcd'));
    const result = analyzeWav(source(plain(0, 0, cat(audio(100), trailing))));
    expect(result).toMatchObject({ status: 'NeedsRepair', dataSize: 112 });
  });

  it('handles an extra LIST chunk before data', () => {
    const fmt = plain(0, 0, new Uint8Array(0)).subarray(12, 36);
    const list = cat(ascii('LIST'), u32(5), ascii('abcde'), new Uint8Array(1));
    const body = audio(64);
    const file = cat(ascii('RIFF'), u32(0), ascii('WAVE'), fmt, list, ascii('data'), u32(0), body);
    const result = analyzeWav(source(file));
    expect(result.status).toBe('NeedsRepair');
    if (result.status === 'NeedsRepair') {
      expect(result.dataSize).toBe(64);
      expect(result.riffSize).toBe(file.length - 8);
    }
  });

  it('repairs an overstated data size', () => {
    const file = plain(0xffff_ffff, 0xffff_ffff, audio(50));
    const result = analyzeWav(source(file));
    expect(result).toMatchObject({ status: 'NeedsRepair', dataSize: 50, riffSize: 44 + 50 - 8 });
  });

  it('with only the RIFF size at zero, fixes the RIFF and keeps the data size', () => {
    const file = plain(0, 100, audio(100));
    expect(analyzeWav(source(file))).toMatchObject({
      status: 'NeedsRepair',
      dataSize: 100,
      riffSize: file.length - 8,
    });
  });

  it('rejects non-WAV bytes and truncated headers', () => {
    expect(analyzeWav(source(ascii('this is not a wav file at all'))).status).toBe('NotWav');
    expect(analyzeWav(source(plain(0, 0, new Uint8Array(0)).subarray(0, 20))).status).toBe(
      'NotWav',
    );
  });

  it('rejects compressed formats as unsupported', () => {
    const file = plain(0, 0, audio(10));
    new DataView(file.buffer).setUint16(20, 2, true); // ADPCM
    expect(analyzeWav(source(file)).status).toBe('Unsupported');
  });

  it('repairs IEEE float and refuses a block align of 0 (item 153)', () => {
    const body = audio(100);
    const float = plain(0, 0, body);
    new DataView(float.buffer).setUint16(20, 3, true); // IEEE float, align 2 from the helper
    expect(analyzeWav(source(float)).status).toBe('NeedsRepair');
    const noAlign = plain(0, 0, body);
    new DataView(noAlign.buffer).setUint16(32, 0, true);
    expect(analyzeWav(source(noAlign)).status).toBe('Unsupported');
  });

  it('does not call a data size of 0 broken when less than one frame follows (item 154)', () => {
    const file = plain(36, 0, new Uint8Array(0));
    expect(analyzeWav(source(file)).status).toBe('Valid');
  });

  it('refuses files above 4 GiB', () => {
    expect(analyzeWav({ length: 0x1_0000_0001, read: () => new Uint8Array(0) }).status).toBe(
      'Unsupported',
    );
  });

  it('reports a file with no data chunk as not a WAV', () => {
    const file = plain(0, 0, new Uint8Array(0)).subarray(0, 36);
    expect(analyzeWav(source(file)).status).toBe('NotWav');
  });
});

describe('buildWavHeader', () => {
  it('is the 46 byte header of the app with both sizes zero', () => {
    const h = buildWavHeader();
    expect(h.length).toBe(WAV_HEADER_BYTES);
    expect([...h.subarray(0, 12)]).toEqual([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect([...h.subarray(16, 38)]).toEqual([
      0x12, 0, 0, 0, 1, 0, 1, 0, 0x80, 0x3e, 0, 0, 0, 0x7d, 0, 0, 2, 0, 0x10, 0, 0, 0,
    ]);
    expect([...h.subarray(38, 46)]).toEqual([0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0]);
  });
});

describe('readWavInfo', () => {
  it('returns the duration of a consistent file', () => {
    const info = readWavInfo(source(plain(36 + 64000, 64000, new Uint8Array(64000))));
    expect(info.sampleRate).toBe(16000);
    expect(info.seconds).toBe(2);
  });

  it('does not repair: a file with zero sizes fails', () => {
    expect(() => readWavInfo(source(cat(buildWavHeader(0), audio(100))))).toThrow();
  });
});

describe('WavHeaderFlushCadence', () => {
  it('is false below the interval and true once at it', () => {
    const c = new WavHeaderFlushCadence(100);
    expect(c.shouldFlush(99)).toBe(false);
    expect(c.shouldFlush(100)).toBe(true);
    expect(c.shouldFlush(100)).toBe(false);
  });

  it('counts the next interval from the last flush', () => {
    const c = new WavHeaderFlushCadence(100);
    expect(c.shouldFlush(130)).toBe(true);
    expect(c.shouldFlush(229)).toBe(false);
    expect(c.shouldFlush(230)).toBe(true);
  });

  it('forFormat uses seconds of audio', () => {
    const c = WavHeaderFlushCadence.forFormat(32000, 5);
    expect(c.shouldFlush(159_999)).toBe(false);
    expect(c.shouldFlush(160_000)).toBe(true);
  });

  it.each([0, -1])('rejects a non-positive interval (%s)', (n) => {
    expect(() => new WavHeaderFlushCadence(n)).toThrow();
  });
});
