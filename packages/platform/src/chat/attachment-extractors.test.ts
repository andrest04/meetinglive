import { describe, expect, it } from 'vitest';
import { buildDocx, buildPdf, buildPptx } from './attachment-fixtures';
import { decodeText, extractDocument } from './attachment-extractors';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('text files', () => {
  it('reads UTF-8 and drops the BOM', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Año: 2026\nok')]);
    expect(decodeText(bom)).toBe('Año: 2026\nok');
    const result = await extractDocument('text', utf8('name,total\nAna,3\n'));
    expect(result).toEqual({
      ok: true,
      pages: null,
      truncated: false,
      sections: [{ location: null, text: 'name,total\nAna,3\n' }],
    });
  });

  it('reads UTF-16 with a BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x48, 0x00, 0x69, 0x00]);
    expect(decodeText(le)).toBe('Hi');
  });

  it('cuts a long file at the character limit and says so', async () => {
    const result = await extractDocument('text', utf8('a'.repeat(50)), 20);
    expect(result).toMatchObject({ ok: true, truncated: true });
    if (result.ok) expect(result.sections[0]?.text).toBe('a'.repeat(20));
  });

  it('an empty or blank file has no text', async () => {
    expect(await extractDocument('text', utf8('  \n'))).toEqual({ ok: false, reason: 'no-text' });
  });
});

describe('PDF', () => {
  it('reads each page under its page number', async () => {
    const result = await extractDocument('pdf', buildPdf(['Budget is ten', 'Launch in May']));
    expect(result).toEqual({
      ok: true,
      pages: 2,
      truncated: false,
      sections: [
        { location: { kind: 'page', n: 1 }, text: 'Budget is ten' },
        { location: { kind: 'page', n: 2 }, text: 'Launch in May' },
      ],
    });
  });

  it('skips pages without text but keeps the numbering', async () => {
    const result = await extractDocument('pdf', buildPdf(['', 'Only page two']));
    expect(result).toMatchObject({
      ok: true,
      pages: 2,
      sections: [{ location: { kind: 'page', n: 2 }, text: 'Only page two' }],
    });
  });

  it('a PDF with no text at all (a scan) says so', async () => {
    expect(await extractDocument('pdf', buildPdf(['', '']))).toEqual({
      ok: false,
      reason: 'no-text',
    });
  });

  it('a damaged file is unreadable, not a crash', async () => {
    expect(await extractDocument('pdf', utf8('%PDF-1.4 garbage'))).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});

describe('DOCX', () => {
  it('reads the paragraphs', async () => {
    const result = await extractDocument('docx', await buildDocx(['First point', 'Second point']));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pages).toBeNull();
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0]?.text).toContain('First point');
      expect(result.sections[0]?.text).toContain('Second point');
    }
  });

  it('an encrypted Office file (a compound file, not a zip) is reported as protected', async () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(await extractDocument('docx', cfb)).toEqual({ ok: false, reason: 'encrypted' });
    expect(await extractDocument('pptx', cfb)).toEqual({ ok: false, reason: 'encrypted' });
  });

  it('a file that is not a document is unreadable', async () => {
    expect(await extractDocument('docx', utf8('plain text'))).toEqual({
      ok: false,
      reason: 'unreadable',
    });
  });
});

describe('PPTX', () => {
  it('reads slides in presentation order, not file-name order', async () => {
    const deck = await buildPptx([['Roadmap', 'Q1 & Q2'], ['Risks'], ['Thanks']]);
    expect(await extractDocument('pptx', deck)).toEqual({
      ok: true,
      pages: 3,
      truncated: false,
      sections: [
        { location: { kind: 'slide', n: 1 }, text: 'Roadmap\nQ1 & Q2' },
        { location: { kind: 'slide', n: 2 }, text: 'Risks' },
        { location: { kind: 'slide', n: 3 }, text: 'Thanks' },
      ],
    });
  });

  it('a deck with no text says so', async () => {
    expect(await extractDocument('pptx', await buildPptx([[], []]))).toEqual({
      ok: false,
      reason: 'no-text',
    });
  });
});
