import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasAudioBytes } from './audio-file';

describe('hasAudioBytes (B20)', () => {
  it('is false for a missing or zero-byte file and true when the file has bytes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-audio-'));
    try {
      const empty = path.join(dir, 'empty.wav');
      const full = path.join(dir, 'full.wav');
      fs.writeFileSync(empty, '');
      fs.writeFileSync(full, 'RIFF');
      expect(hasAudioBytes(path.join(dir, 'missing.wav'))).toBe(false);
      expect(hasAudioBytes(empty)).toBe(false);
      expect(hasAudioBytes(full)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
