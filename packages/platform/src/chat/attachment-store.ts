/**
 * The files attached to the one chat conversation, held in the main process. Paths live only
 * here: the page sees opaque ids. A path is checked (absolute, local, a regular file, an allowed
 * type, at most 20 MB) before anything reads it, and text is extracted in the background while
 * the chip says it is reading.
 */
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_CHARS,
  ATTACHMENT_MAX_FILES,
  ATTACHMENT_MESSAGE_KEYS,
  attachmentKindForName,
  type AttachedDocument,
  type AttachmentKind,
  type AttachmentSection,
  type ChatAttachmentSource,
  type Logger,
  type ResolvedAttachments,
  type StagedImages,
  type TranslateFn,
} from '@vozella/core';
import { extractDocument, type ExtractFailure } from './attachment-extractors';
import type { DocumentExtractor } from './document-extraction';

// The off-thread extractor ships with the store that uses it (the package index lists this file).
export * from './document-extraction';

/** One chip, in the shape of the `chat.attach.*` contract. */
export interface ChatAttachmentView {
  readonly id: string;
  readonly name: string;
  readonly kind: AttachmentKind;
  readonly sizeBytes: number;
  readonly pages: number | null;
  readonly status: 'reading' | 'ready' | 'error';
  readonly message: string | null;
  readonly truncated: boolean;
}

export type PathRefusal = 'not-found' | 'unsupported' | 'too-large';

export type PathCheck =
  | {
      readonly ok: true;
      readonly kind: AttachmentKind;
      readonly name: string;
      readonly sizeBytes: number;
    }
  | { readonly ok: false; readonly reason: PathRefusal; readonly name: string };

/**
 * UNC (`\\server\share`), `//server` and device paths (`\\?\`, `\\.\`) are refused: touching
 * them can reach the network or a device, and a dropped file is never one.
 */
const NETWORK_OR_DEVICE = /^(?:[\\/]{2})/;

/** Checks a picked or dropped path before it is read. Never throws. */
export async function checkAttachmentPath(
  file: string,
  maxBytes: number = ATTACHMENT_MAX_BYTES,
): Promise<PathCheck> {
  const name = path.basename(file);
  if (!path.isAbsolute(file) || NETWORK_OR_DEVICE.test(file)) {
    return { ok: false, reason: 'not-found', name };
  }
  const kind = attachmentKindForName(name);
  if (kind === null) return { ok: false, reason: 'unsupported', name };
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return { ok: false, reason: 'not-found', name };
    if (stat.size > maxBytes) return { ok: false, reason: 'too-large', name };
    return { ok: true, kind, name, sizeBytes: stat.size };
  } catch {
    return { ok: false, reason: 'not-found', name };
  }
}

interface Entry {
  view: ChatAttachmentView;
  readonly path: string;
  sections: readonly AttachmentSection[];
  /** Settles when the text is extracted (or the file failed). */
  done: Promise<void>;
}

export interface ChatAttachmentStoreOptions {
  readonly translate: TranslateFn;
  readonly newId?: () => string;
  /** Where per-send image copies go. Default: the OS temp folder. */
  readonly tempRoot?: string;
  readonly logger?: Logger;
  readonly maxFiles?: number;
  readonly maxBytes?: number;
  readonly maxChars?: number;
  /**
   * How a document's text is extracted. The app passes a worker-thread extractor so a large PDF
   * cannot freeze the main process; the default parses in the calling thread (tests, tools).
   */
  readonly extractor?: DocumentExtractor;
}

const MB = 1024 * 1024;

/** A file name safe on every shell and for Codex's comma-split `-i`: letters, digits, ` ._()-`. */
const safeFileName = (name: string): string => name.replace(/[^\p{L}\p{N} ._()-]/gu, '_');

export class ChatAttachmentStore implements ChatAttachmentSource {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private readonly newId: () => string;
  private readonly maxFiles: number;
  private readonly maxBytes: number;
  private readonly maxChars: number;
  private readonly extractor: DocumentExtractor;

  constructor(private readonly options: ChatAttachmentStoreOptions) {
    this.newId = options.newId ?? (() => `att-${randomUUID()}`);
    this.maxFiles = options.maxFiles ?? ATTACHMENT_MAX_FILES;
    this.maxBytes = options.maxBytes ?? ATTACHMENT_MAX_BYTES;
    this.maxChars = options.maxChars ?? ATTACHMENT_MAX_CHARS;
    this.extractor = options.extractor ?? extractDocument;
  }

  list(): readonly ChatAttachmentView[] {
    return [...this.entries.values()].map((e) => e.view);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Adds the files that pass the checks as reading chips, refused ones as error chips. Files past
   * the limit, and files already attached, are left out; the notice says when the limit cut some.
   */
  async add(paths: readonly string[]): Promise<{ notice: string | null }> {
    let overLimit = false;
    const known = new Set([...this.entries.values()].map((e) => path.resolve(e.path)));
    for (const file of paths) {
      if (known.has(path.resolve(file))) continue;
      if (this.entries.size >= this.maxFiles) {
        overLimit = true;
        continue;
      }
      known.add(path.resolve(file));
      const check = await checkAttachmentPath(file, this.maxBytes);
      const id = this.newId();
      const view: ChatAttachmentView = {
        id,
        name: check.name,
        kind: check.ok ? check.kind : (attachmentKindForName(check.name) ?? 'text'),
        sizeBytes: check.ok ? check.sizeBytes : 0,
        pages: null,
        status: check.ok ? 'reading' : 'error',
        message: check.ok ? null : this.refusal(check.reason),
        truncated: false,
      };
      const entry: Entry = { view, path: file, sections: [], done: Promise.resolve() };
      this.entries.set(id, entry);
      if (check.ok) entry.done = this.read(id, entry);
    }
    this.notify();
    return {
      notice: overLimit
        ? this.options.translate(ATTACHMENT_MESSAGE_KEYS.limit, this.maxFiles)
        : null,
    };
  }

  remove(id: string): boolean {
    const removed = this.entries.delete(id);
    if (removed) this.notify();
    return removed;
  }

  /** New chat: every file goes. */
  clear(): void {
    if (this.entries.size === 0) return;
    this.entries.clear();
    this.notify();
  }

  /** Resolves when every extraction started so far has finished. */
  async settled(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => e.done));
  }

  async resolve(ids: readonly string[]): Promise<ResolvedAttachments> {
    const picked = await this.readyEntries(ids);
    const documents: AttachedDocument[] = [];
    const imageNames: string[] = [];
    for (const { view, sections } of picked) {
      if (view.kind === 'image') {
        imageNames.push(view.name);
      } else {
        documents.push({
          name: view.name,
          kind: view.kind,
          pages: view.pages,
          truncated: view.truncated,
          sections,
        });
      }
    }
    return { documents, imageNames };
  }

  async stageImages(ids: readonly string[]): Promise<StagedImages | null> {
    const images = (await this.readyEntries(ids)).filter((e) => e.view.kind === 'image');
    if (images.length === 0) return null;
    const root = this.options.tempRoot ?? os.tmpdir();
    const directory = await fsp.mkdtemp(path.join(root, 'vozella-chat-'));
    const release = async (): Promise<void> => {
      await fsp.rm(directory, { recursive: true, force: true }).catch((error: unknown) => {
        this.options.logger?.warn('chat image copies not removed', { error });
      });
    };
    try {
      const used = new Set<string>();
      const names: string[] = [];
      const paths: string[] = [];
      for (const [index, image] of images.entries()) {
        let name = safeFileName(image.view.name);
        if (used.has(name.toLowerCase())) {
          const ext = path.extname(name);
          name = `${path.basename(name, ext)}-${String(index + 1)}${ext}`;
        }
        used.add(name.toLowerCase());
        const target = path.join(directory, name);
        await fsp.copyFile(image.path, target);
        names.push(name);
        paths.push(target);
      }
      return { directory, paths, names, release };
    } catch (error) {
      await release();
      throw error;
    }
  }

  /** The ready entries among `ids`, after their extraction finished, in attachment order. */
  private async readyEntries(ids: readonly string[]): Promise<Entry[]> {
    const wanted = new Set(ids);
    const entries = [...this.entries.entries()]
      .filter(([id]) => wanted.has(id))
      .map(([, entry]) => entry);
    await Promise.all(entries.map((e) => e.done));
    return entries.filter((e) => e.view.status === 'ready');
  }

  private async read(id: string, entry: Entry): Promise<void> {
    let next: Partial<ChatAttachmentView>;
    let sections: readonly AttachmentSection[] = [];
    try {
      if (entry.view.kind === 'image') {
        next = { status: 'ready' };
      } else {
        const data = await fsp.readFile(entry.path);
        // Checked again on the bytes read: the file may have grown since the check.
        if (data.byteLength > this.maxBytes) {
          next = { status: 'error', message: this.refusal('too-large') };
        } else {
          const result = await this.extractor(entry.view.kind, data, this.maxChars);
          if (result.ok) {
            sections = result.sections;
            next = {
              status: 'ready',
              pages: result.pages,
              truncated: result.truncated,
              message: result.truncated
                ? this.options.translate(ATTACHMENT_MESSAGE_KEYS.truncated)
                : null,
            };
          } else {
            next = { status: 'error', message: this.refusal(result.reason) };
          }
        }
      }
    } catch (error) {
      this.options.logger?.warn('chat attachment not read', { error, kind: entry.view.kind });
      next = { status: 'error', message: this.refusal('unreadable') };
    }
    // Removed or cleared meanwhile: the result is dropped.
    if (this.entries.get(id) !== entry) return;
    entry.sections = sections;
    entry.view = { ...entry.view, ...next };
    this.notify();
  }

  private refusal(reason: PathRefusal | ExtractFailure): string {
    const key = ATTACHMENT_MESSAGE_KEYS[reason];
    return reason === 'too-large'
      ? this.options.translate(key, Math.max(1, Math.ceil(this.maxBytes / MB)))
      : this.options.translate(key);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
