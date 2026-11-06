/**
 * Files attached to the chat (Phase 3 of the AI panel). Pure: the main process reads and extracts
 * the files; this module names the limits, the kinds, and how their text is packed for the model.
 * File text is untrusted data: it is neutralized like meeting text and never read as instructions.
 */
import type { ProviderId } from '../summaries/provider';
import { neutralizeStructure, singleLine } from './context-packer';
import { scoreWindows, splitTextChunks } from './transcript-retrieval';

export type AttachmentKind = 'pdf' | 'docx' | 'pptx' | 'text' | 'image';
export type DocumentKind = Exclude<AttachmentKind, 'image'>;

/** At most this many files per conversation. */
export const ATTACHMENT_MAX_FILES = 10;
/** Larger files are refused before they are read. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
/** Extracted text is cut here, per file, and the file is marked truncated. */
export const ATTACHMENT_MAX_CHARS = 200_000;

/** Claude Code and Codex: meeting context plus files stay near this many characters. */
export const CLI_TOTAL_CONTEXT_CHARS = 120_000;
/** Files keep at least this much on a CLI engine, even when the meeting fills the total. */
export const CLI_ATTACHMENT_MIN_CHARS = 24_000;
/** Local llama has 4096 tokens: files get a small, fixed share. */
export const LOCAL_ATTACHMENT_CHARS = 2_500;

/** Added to a file header when only ranked parts of it were packed. */
export const ATTACHMENT_EXCERPTS_NOTE = 'excerpts; other parts were left out';

const EXTENSIONS: Readonly<Record<string, AttachmentKind>> = {
  pdf: 'pdf',
  docx: 'docx',
  pptx: 'pptx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
};

/** Why a file cannot be used: refused before reading, or failed while reading. */
export type AttachmentProblem =
  'not-found' | 'unsupported' | 'too-large' | 'encrypted' | 'no-text' | 'unreadable';

/** The string keys (ui catalog) of each problem and note shown on a chip. */
export const ATTACHMENT_MESSAGE_KEYS: Readonly<
  Record<AttachmentProblem | 'truncated' | 'limit', string>
> = {
  'not-found': 'Ui_ChatAttachNotFound',
  unsupported: 'Ui_ChatAttachUnsupported',
  'too-large': 'Ui_ChatAttachTooLarge',
  encrypted: 'Ui_ChatAttachEncrypted',
  'no-text': 'Ui_ChatAttachNoText',
  unreadable: 'Ui_ChatAttachUnreadable',
  truncated: 'Ui_ChatAttachTruncated',
  limit: 'Ui_ChatAttachLimit',
};

/** Extensions the file dialog offers, without the dot. */
export const ATTACHMENT_EXTENSIONS: readonly string[] = Object.keys(EXTENSIONS);

/** The kind a file name stands for, by its extension; null when it cannot be attached. */
export function attachmentKindForName(name: string): AttachmentKind | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return EXTENSIONS[name.slice(dot + 1).toLowerCase()] ?? null;
}

/** Where a piece of text sits in its file, when the format has pages or slides. */
export interface AttachmentLocation {
  readonly kind: 'page' | 'slide';
  readonly n: number;
}

export interface AttachmentSection {
  readonly location: AttachmentLocation | null;
  readonly text: string;
}

/** The extracted text of one attached document, as the packer needs it. */
export interface AttachedDocument {
  readonly name: string;
  readonly kind: DocumentKind;
  /** Pages of a PDF or slides of a presentation; null for other kinds. */
  readonly pages: number | null;
  /** The text was cut at `ATTACHMENT_MAX_CHARS`. */
  readonly truncated: boolean;
  readonly sections: readonly AttachmentSection[];
}

/** Images copied for one send. `release` deletes the copies; it never throws. */
export interface StagedImages {
  /** A directory that holds only these copies. */
  readonly directory: string;
  /** Absolute paths of the copies, in attachment order. */
  readonly paths: readonly string[];
  /** The names the user knows the images by, in the same order. */
  readonly names: readonly string[];
  release(): Promise<void>;
}

export interface ResolvedAttachments {
  readonly documents: readonly AttachedDocument[];
  /** Names of the ready image attachments. */
  readonly imageNames: readonly string[];
}

/**
 * The port the chat reads attachments through. Ids that are unknown, still failing or removed are
 * skipped: only files the main process picked or validated can ever reach a prompt.
 */
export interface ChatAttachmentSource {
  /** Waits for files still being read, then returns the ready ones. */
  resolve(ids: readonly string[]): Promise<ResolvedAttachments>;
  /** Copies the ready images to a fresh directory for one send; null when there are none. */
  stageImages(ids: readonly string[]): Promise<StagedImages | null>;
}

export const isCliEngine = (providerId: ProviderId | undefined): boolean =>
  providerId === 'claude-code' || providerId === 'codex';

/** Room for files: CLI engines share the 120k total with the meeting; local gets a fixed share. */
export function attachmentBudgetFor(
  providerId: ProviderId | undefined,
  contextChars: number,
): number {
  if (!isCliEngine(providerId)) return LOCAL_ATTACHMENT_CHARS;
  return Math.max(CLI_TOTAL_CONTEXT_CHARS - contextChars, CLI_ATTACHMENT_MIN_CHARS);
}

export const locationTag = (location: AttachmentLocation): string =>
  `[${location.kind} ${String(location.n)}]`;

/**
 * Lines of file text that could pass for packing structure: a file header or a page or slide tag.
 * `neutralizeStructure` already covers `Id:` and `# ` headings.
 */
const FORGED_FILE_STRUCTURE = /^[ \t]*(?:File[ \t]*:|\[(?:page|slide)[ \t]+\d+\])/i;

function neutralizeFileText(text: string): string {
  return neutralizeStructure(text)
    .split('\n')
    .map((line) => (FORGED_FILE_STRUCTURE.test(line) ? `> ${line}` : line))
    .join('\n');
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

function header(d: AttachedDocument, excerpts: boolean): string {
  const notes: string[] = [];
  if (d.kind === 'pdf' && d.pages !== null) notes.push(`PDF, ${plural(d.pages, 'page', 'pages')}`);
  if (d.kind === 'pptx' && d.pages !== null) {
    notes.push(`presentation, ${plural(d.pages, 'slide', 'slides')}`);
  }
  if (d.truncated) notes.push('only the first 200000 characters were read');
  if (excerpts) notes.push(ATTACHMENT_EXCERPTS_NOTE);
  const name = `File: ${singleLine(d.name)}`;
  return notes.length === 0 ? name : `${name} (${notes.join('; ')})`;
}

interface Chunk {
  readonly doc: number;
  /** Order inside its document. */
  readonly pos: number;
  readonly tag: string | null;
  readonly text: string;
}

function renderBlock(head: string, chunks: readonly Chunk[]): string {
  const lines = [head];
  let lastTag: string | null = null;
  for (const c of chunks) {
    if (c.tag !== null && c.tag !== lastTag) lines.push(c.tag);
    lastTag = c.tag;
    if (c.text !== '') lines.push(c.text);
  }
  return lines.join('\n');
}

const BLOCK_SEPARATOR = '\n\n';

/**
 * The attached files within `budgetChars`: every file whole when they all fit; otherwise the parts
 * that best match `query` (BM25, as the transcript excerpts), in file order, each under its page or
 * slide tag. With no match the first parts of each file come first, so every file is represented.
 */
export function packAttachments(
  documents: readonly AttachedDocument[],
  budgetChars: number,
  query: string,
): string {
  if (documents.length === 0) return '';
  const neutral = documents.map((d) =>
    d.sections.map((s) => ({
      tag: s.location === null ? null : locationTag(s.location),
      text: neutralizeFileText(s.text.trim()),
    })),
  );

  const whole = documents
    .map((d, i) =>
      renderBlock(
        header(d, false),
        (neutral[i] ?? []).map((s, pos) => ({ doc: i, pos, ...s })),
      ),
    )
    .join(BLOCK_SEPARATOR);
  if (whole.length <= budgetChars) return whole;

  const chunkChars = Math.max(200, Math.min(1500, Math.floor(budgetChars / 3)));
  const chunks: Chunk[] = [];
  neutral.forEach((sections, doc) => {
    let pos = 0;
    for (const s of sections) {
      for (const text of splitTextChunks(s.text, chunkChars)) {
        chunks.push({ doc, pos, tag: s.tag, text });
        pos += 1;
      }
    }
  });
  const scores = scoreWindows(
    chunks.map((c) => ({ startMs: null, endMs: null, text: c.text })),
    query,
  );
  const ranked = chunks
    .map((c, index) => ({ c, score: scores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score || a.c.pos - b.c.pos || a.c.doc - b.c.doc);

  const heads = documents.map((d) => header(d, true));
  let room =
    budgetChars -
    heads.reduce((sum, h) => sum + h.length, 0) -
    BLOCK_SEPARATOR.length * (documents.length - 1);
  const picked: Chunk[] = [];
  for (const { c } of ranked) {
    const cost = (c.tag === null ? 0 : c.tag.length + 1) + c.text.length + 1;
    if (cost > room) continue;
    picked.push(c);
    room -= cost;
  }
  return heads
    .map((head, doc) =>
      renderBlock(
        head,
        picked.filter((c) => c.doc === doc).sort((a, b) => a.pos - b.pos),
      ),
    )
    .join(BLOCK_SEPARATOR);
}
