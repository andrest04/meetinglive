import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildPdf } from './attachment-fixtures';
import { ChatAttachmentStore, checkAttachmentPath } from './attachment-store';

const t = (key: string, ...args: unknown[]): string =>
  args.length === 0 ? key : `${key}(${args.map(String).join(',')})`;

let dir: string;
let tempRoot: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-att-test-'));
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vz-att-stage-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const write = (name: string, data: string | Uint8Array): string => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
};

function store(over: Partial<ConstructorParameters<typeof ChatAttachmentStore>[0]> = {}) {
  let n = 0;
  return new ChatAttachmentStore({
    translate: t,
    newId: () => `att-${String((n += 1))}`,
    tempRoot,
    ...over,
  });
}

describe('checkAttachmentPath', () => {
  it('accepts a local regular file of an allowed type', async () => {
    const file = write('notes.md', '# hi');
    expect(await checkAttachmentPath(file)).toEqual({
      ok: true,
      kind: 'text',
      name: 'notes.md',
      sizeBytes: 4,
    });
  });

  it('refuses a relative path, a network path and a device path', async () => {
    expect(await checkAttachmentPath('notes.md')).toMatchObject({ ok: false, reason: 'not-found' });
    expect(await checkAttachmentPath('\\\\server\\share\\a.pdf')).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
    expect(await checkAttachmentPath('//server/share/a.pdf')).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
    expect(await checkAttachmentPath('\\\\?\\C:\\a.pdf')).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('refuses a type that cannot be attached', async () => {
    const file = write('tool.exe', 'MZ');
    expect(await checkAttachmentPath(file)).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('refuses a folder and a missing file', async () => {
    fs.mkdirSync(path.join(dir, 'folder.pdf'));
    expect(await checkAttachmentPath(path.join(dir, 'folder.pdf'))).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
    expect(await checkAttachmentPath(path.join(dir, 'gone.pdf'))).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('refuses a file over the size limit before reading it', async () => {
    const file = write('big.txt', 'x'.repeat(11));
    expect(await checkAttachmentPath(file, 10)).toMatchObject({ ok: false, reason: 'too-large' });
  });
});

describe('ChatAttachmentStore', () => {
  it('shows a file as reading, then ready with its page count', async () => {
    const s = store();
    await s.add([write('plan.pdf', buildPdf(['Budget ten', 'Launch May']))]);
    expect(s.list()[0]).toMatchObject({ id: 'att-1', name: 'plan.pdf', status: 'reading' });
    await s.settled();
    expect(s.list()).toEqual([
      {
        id: 'att-1',
        name: 'plan.pdf',
        kind: 'pdf',
        sizeBytes: expect.any(Number) as number,
        pages: 2,
        status: 'ready',
        message: null,
        truncated: false,
      },
    ]);
  });

  it('turns a refused file into an error chip with a clear message', async () => {
    const s = store({ maxBytes: 5 });
    await s.add([write('tool.exe', 'MZ'), write('big.txt', 'too long'), path.join(dir, 'x.pdf')]);
    await s.settled();
    expect(s.list().map((a) => [a.name, a.status, a.message])).toEqual([
      ['tool.exe', 'error', 'Ui_ChatAttachUnsupported'],
      ['big.txt', 'error', 'Ui_ChatAttachTooLarge(1)'],
      ['x.pdf', 'error', 'Ui_ChatAttachNotFound'],
    ]);
  });

  it('marks a scanned PDF with no text as an error', async () => {
    const s = store();
    await s.add([write('scan.pdf', buildPdf(['', '']))]);
    await s.settled();
    expect(s.list()[0]).toMatchObject({
      status: 'error',
      message: 'Ui_ChatAttachNoText',
      pages: null,
    });
  });

  it('notes a file cut at the character limit', async () => {
    const s = store({ maxChars: 10 });
    await s.add([write('long.txt', 'abcdefghijklmnop')]);
    await s.settled();
    expect(s.list()[0]).toMatchObject({
      status: 'ready',
      truncated: true,
      message: 'Ui_ChatAttachTruncated',
    });
  });

  it('keeps at most 10 files and says so; the same file is not added twice', async () => {
    const s = store();
    const files = Array.from({ length: 12 }, (_, i) =>
      write(`f${String(i)}.txt`, `file ${String(i)}`),
    );
    const first = await s.add([files[0] ?? '', files[0] ?? '']);
    expect(first.notice).toBeNull();
    expect(s.list()).toHaveLength(1);
    const second = await s.add(files.slice(1));
    expect(s.list()).toHaveLength(10);
    expect(second.notice).toBe('Ui_ChatAttachLimit(10)');
  });

  it('resolves only ready documents and images, in attachment order, and skips unknown ids', async () => {
    const s = store();
    await s.add([
      write('a.txt', 'alpha'),
      write('board.png', 'PNG'),
      write('bad.exe', 'x'),
      write('b.csv', 'x,y'),
    ]);
    const resolved = await s.resolve(['att-4', 'att-1', 'att-2', 'att-3', 'nope']);
    expect(resolved.documents.map((d) => [d.name, d.sections[0]?.text])).toEqual([
      ['a.txt', 'alpha'],
      ['b.csv', 'x,y'],
    ]);
    expect(resolved.imageNames).toEqual(['board.png']);
  });

  it('removes one file and clears all; a late extraction does not come back', async () => {
    const s = store();
    let changes = 0;
    s.onChange(() => (changes += 1));
    await s.add([write('a.txt', 'alpha'), write('b.txt', 'beta')]);
    expect(s.remove('att-1')).toBe(true);
    expect(s.remove('att-1')).toBe(false);
    s.clear();
    await s.settled();
    expect(s.list()).toEqual([]);
    expect(changes).toBeGreaterThan(0);
  });

  it('copies ready images to a fresh folder for one send and deletes it on release', async () => {
    const s = store();
    await s.add([
      write('board shot,1.png', 'PNG1'),
      write('notes.txt', 'n'),
      write('chart.jpg', 'JPG'),
    ]);
    const staged = await s.stageImages(['att-1', 'att-2', 'att-3']);
    expect(staged).not.toBeNull();
    if (staged === null) return;
    expect(path.dirname(staged.directory)).toBe(tempRoot);
    expect(staged.names).toEqual(['board shot_1.png', 'chart.jpg']);
    expect(staged.paths.map((p) => path.basename(p))).toEqual(staged.names);
    expect(staged.paths.every((p) => !p.includes(','))).toBe(true);
    expect(fs.readFileSync(staged.paths[0] ?? '', 'utf8')).toBe('PNG1');
    await staged.release();
    expect(fs.existsSync(staged.directory)).toBe(false);
  });

  it('stages nothing when there are no ready images', async () => {
    const s = store();
    await s.add([write('notes.txt', 'n')]);
    expect(await s.stageImages(['att-1'])).toBeNull();
  });
});
