import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realFileOps, writeFileAtomic, type AtomicFileOps } from './atomic-write';
import { KeyedMutex, lockKeyFor } from './keyed-mutex';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-atomic-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const noSleep = () => Promise.resolve();

describe('writeFileAtomic', () => {
  it('creates missing folders and writes the file', async () => {
    const target = path.join(dir, 'a', 'b', 'file.json');
    await writeFileAtomic(target, '{"a":1}');
    expect(fs.readFileSync(target, 'utf8')).toBe('{"a":1}');
  });

  it('replaces an existing file and leaves no temp file behind', async () => {
    const target = path.join(dir, 'file.txt');
    fs.writeFileSync(target, 'old');
    await writeFileAtomic(target, 'new');
    expect(fs.readFileSync(target, 'utf8')).toBe('new');
    expect(fs.readdirSync(dir)).toEqual(['file.txt']);
  });

  it('B5: a crash while writing leaves the old content intact and cleans up', async () => {
    const target = path.join(dir, 'file.txt');
    fs.writeFileSync(target, 'old');
    const crashing: AtomicFileOps = {
      ...realFileOps,
      writeFile: async (p, data) => {
        // Half of the data reaches the temp file, then the process "dies".
        fs.writeFileSync(p, String(data).slice(0, 2));
        throw new Error('crash');
      },
    };
    await expect(writeFileAtomic(target, 'new content', { ops: crashing })).rejects.toThrow(
      'crash',
    );
    expect(fs.readFileSync(target, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['file.txt']);
  });

  it('retries a rename that fails with EPERM, then succeeds', async () => {
    const target = path.join(dir, 'file.txt');
    let failures = 2;
    const flaky: AtomicFileOps = {
      ...realFileOps,
      rename: async (from, to) => {
        if (failures > 0) {
          failures -= 1;
          throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
        }
        await realFileOps.rename(from, to);
      },
    };
    await writeFileAtomic(target, 'x', { ops: flaky, sleep: noSleep });
    expect(fs.readFileSync(target, 'utf8')).toBe('x');
    expect(failures).toBe(0);
  });

  it('gives up after the retries, keeps the old file, and removes the temp file', async () => {
    const target = path.join(dir, 'file.txt');
    fs.writeFileSync(target, 'old');
    const locked: AtomicFileOps = {
      ...realFileOps,
      rename: () => Promise.reject(Object.assign(new Error('EBUSY'), { code: 'EBUSY' })),
    };
    await expect(
      writeFileAtomic(target, 'new', { ops: locked, sleep: noSleep, retryDelaysMs: [1, 1] }),
    ).rejects.toThrow('EBUSY');
    expect(fs.readFileSync(target, 'utf8')).toBe('old');
    expect(fs.readdirSync(dir)).toEqual(['file.txt']);
  });

  it('does not retry errors that are not lock errors', async () => {
    let calls = 0;
    const broken: AtomicFileOps = {
      ...realFileOps,
      rename: () => {
        calls += 1;
        return Promise.reject(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }));
      },
    };
    await expect(
      writeFileAtomic(path.join(dir, 'f'), 'x', { ops: broken, sleep: noSleep }),
    ).rejects.toThrow('ENOSPC');
    expect(calls).toBe(1);
  });

  it('writes bytes unchanged', async () => {
    const target = path.join(dir, 'file.bin');
    await writeFileAtomic(target, new Uint8Array([0, 255, 10, 13]));
    expect([...fs.readFileSync(target)]).toEqual([0, 255, 10, 13]);
  });
});

describe('KeyedMutex', () => {
  it('runs tasks with the same key one at a time, in order', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
    };
    await Promise.all([mutex.run('k', task('a', 20)), mutex.run('k', task('b', 1))]);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b']);
  });

  it('lets different keys overlap', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    await Promise.all([
      mutex.run('x', async () => {
        log.push('x start');
        await new Promise((r) => setTimeout(r, 20));
        log.push('x end');
      }),
      mutex.run('y', () => {
        log.push('y');
        return Promise.resolve();
      }),
    ]);
    expect(log).toEqual(['x start', 'y', 'x end']);
  });

  it('a failing task does not block the next one', async () => {
    const mutex = new KeyedMutex();
    const failing = mutex.run('k', () => Promise.reject(new Error('boom')));
    const next = mutex.run('k', () => Promise.resolve('ok'));
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('keys ignore path case on Windows', () => {
    if (process.platform !== 'win32') return;
    expect(lockKeyFor('C:\\A\\Folders.json')).toBe(lockKeyFor('c:\\a\\folders.JSON'));
  });
});
