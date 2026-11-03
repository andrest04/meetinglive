import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { RotatingFileLogger } from './rotating-file-logger';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-log-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const files = () => fs.readdirSync(dir).sort();

describe('RotatingFileLogger', () => {
  it('writes one timestamped line per entry with scope and context', () => {
    const logger = new RotatingFileLogger({ dir, clock: new FakeClock(), scope: 'main' });
    logger.info('hello', { a: 1 });
    logger.error('multi\nline');
    const lines = fs.readFileSync(logger.filePath, 'utf8').trimEnd().split('\n');
    expect(lines).toEqual([
      '2026-01-01T00:00:00.000Z INFO  [main] hello {"a":1}',
      '2026-01-01T00:00:00.000Z ERROR [main] multi\\nline',
    ]);
  });

  it('serializes errors in the context', () => {
    const logger = new RotatingFileLogger({ dir });
    logger.error('failed', { error: new Error('boom') });
    expect(fs.readFileSync(logger.filePath, 'utf8')).toContain('"message":"boom"');
  });

  it('rotates by size and keeps at most maxFiles files', () => {
    const logger = new RotatingFileLogger({ dir, maxBytes: 200, maxFiles: 3 });
    for (let i = 0; i < 40; i += 1) {
      logger.info(`entry ${i} ${'x'.repeat(40)}`);
    }
    expect(files()).toEqual(['vozella.log', 'vozella.log.1', 'vozella.log.2']);
    for (const file of files()) {
      expect(fs.statSync(path.join(dir, file)).size).toBeLessThanOrEqual(200);
    }
    // Newest entry is in the active file, oldest surviving ones are in the archives.
    expect(fs.readFileSync(logger.filePath, 'utf8')).toContain('entry 39');
    expect(fs.readFileSync(path.join(dir, 'vozella.log.2'), 'utf8')).not.toContain('entry 0 ');
  });

  it('continues the size of an existing file', () => {
    fs.writeFileSync(path.join(dir, 'vozella.log'), 'x'.repeat(190));
    const logger = new RotatingFileLogger({ dir, maxBytes: 200, maxFiles: 2 });
    logger.info('this line does not fit');
    expect(files()).toEqual(['vozella.log', 'vozella.log.1']);
  });

  it('children share the file and the size accounting', () => {
    const logger = new RotatingFileLogger({ dir, maxBytes: 150, maxFiles: 2 });
    const child = logger.child('audio');
    for (let i = 0; i < 6; i += 1) {
      (i % 2 ? logger : child).info(`line ${i} ${'y'.repeat(40)}`);
    }
    expect(files()).toEqual(['vozella.log', 'vozella.log.1']);
    expect(fs.readFileSync(path.join(dir, 'vozella.log.1'), 'utf8')).toContain('[audio]');
  });

  it('never throws when the file cannot be written', () => {
    const errors: unknown[] = [];
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, '');
    const logger = new RotatingFileLogger({
      dir: path.join(blocker, 'sub'),
      onWriteError: (e) => errors.push(e),
    });
    expect(() => logger.info('x')).not.toThrow();
    expect(errors.length).toBeGreaterThan(0);
  });
});
