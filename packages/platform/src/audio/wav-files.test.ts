import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWavHeader } from '@vozella/core';
import { openWavFileDecoder } from './wav-file-decoder';
import { writeWav } from './wav-test-kit';
import { readWavDurationSeconds, readWavFileInfo, repairWavFile, WavFileWriter } from './wav-files';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-wav-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = (name: string): string => path.join(dir, name);

function audio(bytes: number): Uint8Array {
  return Uint8Array.from({ length: bytes }, (_, i) => (i % 250) + 1);
}

describe('WavFileWriter', () => {
  it('writes a readable 16 kHz mono PCM16 file after close', () => {
    const w = new WavFileWriter(file('a.wav'));
    w.write(audio(32_000));
    w.write(audio(16_000));
    w.close();
    const info = readWavFileInfo(file('a.wav'));
    expect(info).toMatchObject({ sampleRate: 16_000, channels: 1, bitsPerSample: 16 });
    expect(info.seconds).toBe(1.5);
    expect(fs.statSync(file('a.wav')).size).toBe(46 + 48_000);
  });

  it('flush while open leaves a readable copy with the written length', () => {
    const w = new WavFileWriter(file('a.wav'));
    w.write(audio(32_000));
    w.flush();
    fs.copyFileSync(file('a.wav'), file('copy.wav'));
    w.write(audio(32_000));
    w.close();
    expect(readWavFileInfo(file('copy.wav')).seconds).toBe(1);
    expect(readWavFileInfo(file('a.wav')).seconds).toBe(2);
  });

  it('flush, more writes, then flush covers all audio', () => {
    const w = new WavFileWriter(file('a.wav'));
    w.write(audio(6400));
    w.flush();
    w.write(audio(6400));
    w.flush();
    fs.copyFileSync(file('a.wav'), file('copy.wav'));
    w.close();
    expect(readWavFileInfo(file('copy.wav')).dataBytes).toBe(12_800);
  });

  it('without a flush a copy has an unreadable header, and repair recovers the audio', () => {
    const w = new WavFileWriter(file('a.wav'));
    w.write(audio(32_000));
    fs.copyFileSync(file('a.wav'), file('crash.wav'));
    w.close();
    expect(() => readWavDurationSeconds(file('crash.wav'))).toThrow();
    expect(repairWavFile(file('crash.wav'))).toBe('Repaired');
    expect(readWavDurationSeconds(file('crash.wav'))).toBe(1);
  });

  it('rejects writes after close and closes twice without error', () => {
    const w = new WavFileWriter(file('a.wav'));
    w.close();
    w.close();
    expect(() => {
      w.write(audio(2));
    }).toThrow();
  });
});

describe('repairWavFile', () => {
  it('leaves a valid file byte-identical with an unchanged last-write time', () => {
    const w = new WavFileWriter(file('a.wav'));
    w.write(audio(3200));
    w.close();
    const before = fs.readFileSync(file('a.wav'));
    const mtime = fs.statSync(file('a.wav')).mtimeMs;
    expect(repairWavFile(file('a.wav'))).toBe('Valid');
    expect(fs.readFileSync(file('a.wav')).equals(before)).toBe(true);
    expect(fs.statSync(file('a.wav')).mtimeMs).toBe(mtime);
  });

  it('repairs zero sizes on the app layout: riff = 46 + N - 8', () => {
    const body = audio(1000);
    fs.writeFileSync(file('a.wav'), Buffer.concat([buildWavHeader(0), body]));
    expect(repairWavFile(file('a.wav'))).toBe('Repaired');
    const bytes = fs.readFileSync(file('a.wav'));
    expect(bytes.readUInt32LE(4)).toBe(46 + 1000 - 8);
    expect(bytes.readUInt32LE(42)).toBe(1000);
    expect(readWavDurationSeconds(file('a.wav'))).toBeCloseTo(500 / 16000, 6);
  });

  it('rounds an odd trailing byte down to the frame', () => {
    fs.writeFileSync(file('a.wav'), Buffer.concat([buildWavHeader(0), audio(1001)]));
    expect(repairWavFile(file('a.wav'))).toBe('Repaired');
    expect(fs.readFileSync(file('a.wav')).readUInt32LE(42)).toBe(1000);
  });

  it('only fixes the RIFF size when it alone is zero', () => {
    const head = Buffer.from(buildWavHeader(1000));
    head.writeUInt32LE(0, 4);
    fs.writeFileSync(file('a.wav'), Buffer.concat([head, audio(1000)]));
    expect(repairWavFile(file('a.wav'))).toBe('Repaired');
    const bytes = fs.readFileSync(file('a.wav'));
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
    expect(bytes.readUInt32LE(42)).toBe(1000);
  });

  it('fixes an overstated data size', () => {
    const head = Buffer.from(buildWavHeader(0));
    head.writeUInt32LE(0xffff_ffff, 4);
    head.writeUInt32LE(0xffff_ffff, 42);
    fs.writeFileSync(file('a.wav'), Buffer.concat([head, audio(500)]));
    expect(repairWavFile(file('a.wav'))).toBe('Repaired');
    expect(fs.readFileSync(file('a.wav')).readUInt32LE(42)).toBe(500);
  });

  it('reports NotWav for foreign and truncated files and leaves them untouched', () => {
    fs.writeFileSync(file('x.wav'), 'this is plain text, not audio at all');
    fs.writeFileSync(file('t.wav'), buildWavHeader(0).subarray(0, 20));
    const x = fs.readFileSync(file('x.wav'));
    expect(repairWavFile(file('x.wav'))).toBe('NotWav');
    expect(repairWavFile(file('t.wav'))).toBe('NotWav');
    expect(fs.readFileSync(file('x.wav')).equals(x)).toBe(true);
  });

  it('reports Unsupported for a compressed format without touching it', () => {
    const head = Buffer.from(buildWavHeader(0));
    head.writeUInt16LE(2, 20);
    fs.writeFileSync(file('a.wav'), Buffer.concat([head, audio(100)]));
    const before = fs.readFileSync(file('a.wav'));
    expect(repairWavFile(file('a.wav'))).toBe('Unsupported');
    expect(fs.readFileSync(file('a.wav')).equals(before)).toBe(true);
  });

  it('returns Failed for a missing file or a directory, and throws only for a blank path', () => {
    expect(repairWavFile(file('missing.wav'))).toBe('Failed');
    expect(repairWavFile(dir)).toBe('Failed');
    expect(() => repairWavFile('  ')).toThrow();
  });
});

describe('readWavFileInfo', () => {
  it('rejects a blank path', () => {
    expect(() => readWavFileInfo('')).toThrow();
  });
});

describe('openWavFileDecoder', () => {
  function decodeAll(path: string): Uint8Array {
    const decoder = openWavFileDecoder(path);
    const parts: Uint8Array[] = [];
    for (let chunk = decoder.read(); chunk !== null; chunk = decoder.read()) parts.push(chunk);
    decoder.close();
    return Buffer.concat(parts);
  }

  it('turns stereo 44.1 kHz into 16 kHz mono within 50 ms of the duration', () => {
    writeWav(file('s.wav'), { rate: 44_100, channels: 2, seconds: 2 });
    const out = decodeAll(file('s.wav'));
    expect(Math.abs(out.length / 2 / 16_000 - 2)).toBeLessThan(0.05);
  });

  it('passes 16 kHz mono through', () => {
    writeWav(file('m.wav'), { rate: 16_000, channels: 1, seconds: 1 });
    expect(decodeAll(file('m.wav')).length).toBe(32_000);
  });

  it('downmixes every channel of a 6 channel file (fixes C2)', () => {
    writeWav(file('six.wav'), { rate: 16_000, channels: 6, seconds: 1 });
    const out = decodeAll(file('six.wav'));
    expect(out.length).toBe(32_000);
    const samples = new Int16Array(out.buffer, out.byteOffset, out.length / 2);
    expect(Math.max(...samples)).toBeGreaterThan(10_000);
  });

  it('reads 24 bit and float files', () => {
    writeWav(file('b24.wav'), { rate: 16_000, channels: 1, bits: 24, seconds: 0.5 });
    writeWav(file('f32.wav'), { rate: 16_000, channels: 1, bits: 32, float: true, seconds: 0.5 });
    expect(decodeAll(file('b24.wav')).length).toBe(16_000);
    expect(decodeAll(file('f32.wav')).length).toBe(16_000);
  });

  it('throws for bytes that are not audio', () => {
    fs.writeFileSync(file('x.wav'), 'definitely not a wave file');
    expect(() => openWavFileDecoder(file('x.wav'))).toThrow();
  });
});

describe('repairWavFile audit proofs', () => {
  function crashedFile(name: string, bytes: number): string {
    const target = file(name);
    const header = buildWavHeader(0);
    fs.writeFileSync(target, Buffer.concat([header, Buffer.from(audio(bytes))]));
    return target;
  }

  it('157: refuses with Failed when the length changes between analysis and write', () => {
    const target = crashedFile('race.wav', 6400);
    const real = fs.fstatSync.bind(fs);
    let calls = 0;
    const spy = vi.spyOn(fs, 'fstatSync').mockImplementation((fd: number) => {
      calls += 1;
      const stat = real(fd);
      if (calls >= 2) stat.size += 1;
      return stat;
    });
    try {
      expect(repairWavFile(target)).toBe('Failed');
    } finally {
      spy.mockRestore();
    }
    expect(repairWavFile(target)).toBe('Repaired');
  });

  it('157: a file over 4 GiB is Unsupported through repairWavFile', () => {
    const target = crashedFile('big.wav', 6400);
    fs.truncateSync(target, 4 * 1024 ** 3 + 1024);
    expect(repairWavFile(target)).toBe('Unsupported');
  });
});
