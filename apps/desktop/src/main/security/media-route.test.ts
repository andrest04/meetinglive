import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseMediaId, parseRange, serveMeetingAudio } from './media-route';

const ID = '7d2b8c1e-9a47-4d0e-b1c2-5e6f7a8b9c11';
const URL_OK = `vozella://app/media/${ID}`;
let dir: string;
let file: string;
const BYTES = Buffer.from('0123456789');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vozella-media-'));
  file = path.join(dir, 'take.wav');
  fs.writeFileSync(file, BYTES);
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const get = (
  url: string,
  range?: string,
  resolve: (id: string) => Promise<string | null> = () => Promise.resolve(file),
) => serveMeetingAudio(new Request(url, range ? { headers: { Range: range } } : {}), resolve);

describe('parseMediaId', () => {
  it('accepts one meeting id under /media/', () => {
    expect(parseMediaId(URL_OK)).toBe(ID);
  });
  it('rejects other paths, traversal, foreign hosts and schemes', () => {
    expect(parseMediaId('vozella://app/index.html')).toBeNull();
    expect(parseMediaId('vozella://app/media/')).toBeNull();
    expect(parseMediaId('vozella://app/media/..%2F..%2Fsecret')).toBeNull();
    expect(parseMediaId('vozella://app/media/a/b')).toBeNull();
    expect(parseMediaId('vozella://app/media/C%3A%5Cx.wav')).toBeNull();
    expect(parseMediaId(`vozella://evil/media/${ID}`)).toBeNull();
    expect(parseMediaId(`https://app/media/${ID}`)).toBeNull();
  });
});

describe('parseRange', () => {
  it('reads closed, open and suffix ranges', () => {
    expect(parseRange('bytes=2-4', 10)).toEqual({ start: 2, end: 4 });
    expect(parseRange('bytes=6-', 10)).toEqual({ start: 6, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=5-99', 10)).toEqual({ start: 5, end: 9 });
  });
  it('flags unsatisfiable and ignores unsupported headers', () => {
    expect(parseRange('bytes=10-12', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-2', 10)).toBe('unsatisfiable');
    expect(parseRange('items=1-2', 10)).toBeNull();
    expect(parseRange('bytes=0-1,3-4', 10)).toBeNull();
    expect(parseRange(null, 10)).toBeNull();
  });
});

describe('serveMeetingAudio', () => {
  it('serves the whole file with Accept-Ranges', async () => {
    const res = await get(URL_OK);
    expect(res.status).toBe(200);
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Type')).toBe('audio/wav');
    expect(Buffer.from(await res.arrayBuffer())).toEqual(BYTES);
  });
  it('answers a Range with 206 and exactly those bytes', async () => {
    const res = await get(URL_OK, 'bytes=2-4');
    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 2-4/10');
    expect(res.headers.get('Content-Length')).toBe('3');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('234');
  });
  it('answers 416 for a range past the end', async () => {
    const res = await get(URL_OK, 'bytes=50-60');
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */10');
  });
  it('rejects traversal ids without asking the repository', async () => {
    let asked = false;
    const res = await get('vozella://app/media/..%2F..%2Fsecret', undefined, () => {
      asked = true;
      return Promise.resolve(file);
    });
    expect(res.status).toBe(404);
    expect(asked).toBe(false);
  });
  it('is 404 when the record has no audio or the file is empty or missing', async () => {
    expect((await get(URL_OK, undefined, () => Promise.resolve(null))).status).toBe(404);
    const empty = path.join(dir, 'empty.wav');
    fs.writeFileSync(empty, '');
    expect((await get(URL_OK, undefined, () => Promise.resolve(empty))).status).toBe(404);
    const missing = path.join(dir, 'nope.wav');
    expect((await get(URL_OK, undefined, () => Promise.resolve(missing))).status).toBe(404);
  });
  it('only serves GET and HEAD', async () => {
    const res = await serveMeetingAudio(new Request(URL_OK, { method: 'POST', body: 'x' }), () =>
      Promise.resolve(file),
    );
    expect(res.status).toBe(405);
  });
});
