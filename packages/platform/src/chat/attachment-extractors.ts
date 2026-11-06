// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- pdfjs ships no types for its worker; this brings the local declaration along wherever the file is compiled.
/// <reference path="./pdfjs-worker.d.ts" />
/**
 * Text out of attached documents, in the main process. TXT, MD and CSV are decoded directly; PDF
 * goes through pdfjs (legacy build, no canvas), DOCX through mammoth, PPTX through jszip and the
 * slide XML. Every failure is a value (`encrypted`, `no-text`, `unreadable`), never a throw.
 */
import {
  ATTACHMENT_MAX_CHARS,
  cutPrefix,
  type AttachmentSection,
  type DocumentKind,
} from '@vozella/core';
import JSZip from 'jszip';
import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth';

export type ExtractFailure = 'encrypted' | 'no-text' | 'unreadable';

export type ExtractResult =
  | {
      readonly ok: true;
      /** Pages of a PDF or slides of a deck; null for other kinds. */
      readonly pages: number | null;
      readonly truncated: boolean;
      readonly sections: readonly AttachmentSection[];
    }
  | { readonly ok: false; readonly reason: ExtractFailure };

/** UTF-8 by default; a UTF-8 BOM is dropped, a UTF-16 BOM switches the decoding. */
export function decodeText(data: Uint8Array): string {
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  const start = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? 3 : 0;
  return new TextDecoder('utf-8').decode(data.subarray(start));
}

/** Office files saved with a password are OLE compound files, not zips. */
const isCompoundFile = (data: Uint8Array): boolean =>
  data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0;

/** Keeps sections in order until `maxChars`; the section that crosses it is cut. */
function capSections(
  sections: readonly AttachmentSection[],
  maxChars: number,
): { sections: AttachmentSection[]; truncated: boolean } {
  const out: AttachmentSection[] = [];
  let used = 0;
  for (const section of sections) {
    const room = maxChars - used;
    if (section.text.length > room) {
      if (room > 0) out.push({ location: section.location, text: cutPrefix(section.text, room) });
      return { sections: out, truncated: true };
    }
    out.push(section);
    used += section.text.length;
  }
  return { sections: out, truncated: false };
}

function result(
  sections: readonly AttachmentSection[],
  pages: number | null,
  maxChars: number,
): ExtractResult {
  const withText = sections.filter((s) => s.text.trim() !== '');
  if (withText.length === 0) return { ok: false, reason: 'no-text' };
  const capped = capSections(withText, maxChars);
  return { ok: true, pages, truncated: capped.truncated, sections: capped.sections };
}

// ---------------------------------------------------------------------------------------------
// PDF

type PdfJs = typeof PdfJsModule;
let pdfjs: Promise<PdfJs> | null = null;

/**
 * pdfjs runs its parser in the calling thread when `globalThis.pdfjsWorker` holds the worker
 * module, so no worker file has to be found at run time (it is bundled like the rest of main).
 */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const worker: unknown = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist/legacy/build/pdf.mjs');
  })();
  return pdfjs;
}

interface PdfTextItem {
  readonly str?: string;
  readonly hasEOL?: boolean;
}

async function extractPdf(data: Uint8Array, maxChars: number): Promise<ExtractResult> {
  const lib = await loadPdfJs();
  const task = lib.getDocument({
    // pdfjs takes ownership of the buffer; give it a copy.
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const sections: AttachmentSection[] = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages && chars <= maxChars; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const text = (content.items as readonly PdfTextItem[])
        .map((item) => (item.str ?? '') + (item.hasEOL === true ? '\n' : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
      page.cleanup();
      sections.push({ location: { kind: 'page', n }, text });
      chars += text.length;
    }
    return result(sections, doc.numPages, maxChars);
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    return { ok: false, reason: name === 'PasswordException' ? 'encrypted' : 'unreadable' };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// DOCX

async function extractDocx(data: Uint8Array, maxChars: number): Promise<ExtractResult> {
  if (isCompoundFile(data)) return { ok: false, reason: 'encrypted' };
  try {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    const text = value.replace(/\n{3,}/g, '\n\n').trim();
    return result([{ location: null, text }], null, maxChars);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

// ---------------------------------------------------------------------------------------------
// PPTX

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return safeCodePoint(Number.parseInt(code.slice(2), 16)) ?? whole;
    }
    if (code.startsWith('#')) return safeCodePoint(Number.parseInt(code.slice(1), 10)) ?? whole;
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function safeCodePoint(code: number): string | null {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
}

const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match?.[1] ?? null;
};

/** The slide parts in the order `presentation.xml` lists them, or by number when it cannot say. */
async function slideOrder(zip: JSZip): Promise<string[]> {
  const presentation = await zip.file('ppt/presentation.xml')?.async('string');
  const rels = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  if (presentation !== undefined && rels !== undefined) {
    const targets = new Map<string, string>();
    for (const tag of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
      const id = attribute(tag, 'Id');
      const target = attribute(tag, 'Target');
      if (id !== null && target !== null) targets.set(id, target);
    }
    const ordered: string[] = [];
    for (const tag of presentation.match(/<p:sldId\b[^>]*>/g) ?? []) {
      const target = targets.get(attribute(tag, 'r:id') ?? '');
      if (target === undefined) continue;
      ordered.push(target.startsWith('/') ? target.slice(1) : `ppt/${target.replace(/^\.\//, '')}`);
    }
    if (ordered.length > 0) return ordered;
  }
  const number = (name: string): number => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
  return Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => number(a) - number(b));
}

/** The text runs of a slide, one line per paragraph. */
function slideText(xml: string): string {
  const paragraphs = xml.match(/<a:p\b[^>]*>[\s\S]*?<\/a:p>/g) ?? [];
  return paragraphs
    .map((p) =>
      decodeXml((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.slice(5, -6)).join('')),
    )
    .filter((line) => line.trim() !== '')
    .join('\n');
}

async function extractPptx(data: Uint8Array, maxChars: number): Promise<ExtractResult> {
  if (isCompoundFile(data)) return { ok: false, reason: 'encrypted' };
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  try {
    const parts = await slideOrder(zip);
    if (parts.length === 0) return { ok: false, reason: 'unreadable' };
    const sections: AttachmentSection[] = [];
    let chars = 0;
    for (const [index, part] of parts.entries()) {
      if (chars > maxChars) break;
      const xml = (await zip.file(part)?.async('string')) ?? '';
      const text = slideText(xml);
      sections.push({ location: { kind: 'slide', n: index + 1 }, text });
      chars += text.length;
    }
    return result(sections, parts.length, maxChars);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

// ---------------------------------------------------------------------------------------------

/** The text of one attached document, page- or slide-tagged where the format has them. */
export async function extractDocument(
  kind: DocumentKind,
  data: Uint8Array,
  maxChars: number = ATTACHMENT_MAX_CHARS,
): Promise<ExtractResult> {
  switch (kind) {
    case 'text':
      return result([{ location: null, text: decodeText(data) }], null, maxChars);
    case 'pdf':
      return extractPdf(data, maxChars);
    case 'docx':
      return extractDocx(data, maxChars);
    case 'pptx':
      return extractPptx(data, maxChars);
  }
}
