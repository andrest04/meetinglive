import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  LibraryFileCorruptError,
  MeetingFormatError,
  MeetingTrashError,
  fileStem,
  folderChain,
  meetingListItem,
  parseMeetingMarkdown,
  renderMeetingMarkdown,
  sanitizeName,
  siblingWavPath,
  type FolderRecord,
  type Logger,
  type MeetingDeleteMode,
  type MeetingList,
  type MeetingListItem,
  type MeetingRecord,
  type MeetingRepository,
  type SkippedMeetingFile,
} from '@vozella/core';
import { writeFileAtomic } from '../fs/atomic-write';
import { KeyedMutex, lockKeyFor } from '../fs/keyed-mutex';
import {
  directoryFor,
  errorCode,
  exists,
  isUnder,
  listMarkdownFiles,
  moveFile,
  samePath,
} from './library-layout';

export interface MarkdownMeetingRepositoryOptions {
  /** The Library root: the folder that holds Inbox and `folders.json`. */
  readonly root: string;
  readonly folders: { getAll(): Promise<FolderRecord[]> };
  readonly logger?: Logger;
  /** Mutations on one root are serialized here. Defaults to a private mutex. */
  readonly locks?: KeyedMutex;
  /** Test hooks for failures that cannot be provoked with real files. */
  readonly rename?: (from: string, to: string) => Promise<void>;
  readonly unlink?: (path: string) => Promise<void>;
  /** Where a deleted meeting's files go, such as the Recycle Bin. Without it they are unlinked. */
  readonly discard?: (path: string) => Promise<void>;
}

interface IndexEntry {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly legacy: boolean;
  readonly item: MeetingListItem | null;
  readonly skipReason: string | null;
}

const READ_CONCURRENCY = 16;
const probe = { fileExists: (path: string): boolean => existsSync(path) };

/**
 * Meetings as Markdown files under the Library root (spec 3.6).
 *
 * The folder tree on disk is a write-only mirror: a meeting's folder is the `folderId` in its
 * frontmatter. A small in-memory index (id, title, date, snippet per file, keyed by modified
 * time and size) means a Save, Delete or lookup costs one stat per file instead of a parse of
 * every file (B19), and a Library list never re-reads a transcript it has already seen (B28).
 */
export class MarkdownMeetingRepository implements MeetingRepository {
  private readonly cache = new Map<string, IndexEntry>();
  private readonly locks: KeyedMutex;
  private readonly rename: (from: string, to: string) => Promise<void>;
  private readonly unlink: (path: string) => Promise<void>;

  constructor(private readonly options: MarkdownMeetingRepositoryOptions) {
    this.locks = options.locks ?? new KeyedMutex();
    this.rename = options.rename ?? ((from, to) => fs.rename(from, to));
    this.unlink = options.unlink ?? ((path) => fs.unlink(path));
  }

  get root(): string {
    return this.options.root;
  }

  // ------------------------------------------------------------------ reads

  async list(): Promise<MeetingList> {
    const entries = await this.scan();
    const skipped: SkippedMeetingFile[] = [];
    for (const entry of entries) {
      if (entry.skipReason !== null) skipped.push({ path: entry.path, reason: entry.skipReason });
    }
    const winners = new Map<string, IndexEntry>();
    for (const entry of entries) {
      if (entry.item === null) continue;
      const kept = winners.get(entry.item.id);
      if (kept === undefined || this.prefer(entry, kept)) winners.set(entry.item.id, entry);
    }
    const items = [...winners.values()]
      .map((e) => e.item)
      .filter((i): i is MeetingListItem => i !== null);
    return { items, skipped };
  }

  async get(id: string): Promise<MeetingRecord | null> {
    const entry = await this.pick(id);
    return entry ? this.parseFile(entry.path) : null;
  }

  /** Paths of every file holding this id, current layout first. For migrations. */
  async locate(id: string): Promise<{ path: string; legacy: boolean }[]> {
    const entries = await this.scan();
    return entries
      .filter((e) => e.item?.id === id)
      .sort((a, b) => Number(a.legacy) - Number(b.legacy))
      .map((e) => ({ path: e.path, legacy: e.legacy }));
  }

  // ----------------------------------------------------------------- writes

  save(record: MeetingRecord): Promise<MeetingRecord> {
    return this.locks.run(this.lockKey(), () => this.saveLocked(record));
  }

  delete(id: string, mode: MeetingDeleteMode = 'trash'): Promise<void> {
    return this.locks.run(this.lockKey(), () => this.deleteLocked(id, mode));
  }

  private async saveLocked(record: MeetingRecord): Promise<MeetingRecord> {
    const folders = await this.folderList();
    const directory = directoryFor(this.root, folders, record.folderId);
    const desiredStem = fileStem(record.recordedAt, record.title);

    const existing = await this.pick(record.id);
    let existingAudio = record.audioFilePath;
    if (existingAudio.trim() === '' && existing) existingAudio = siblingWavPath(existing.path);

    const stem = await this.allocateStem(directory, desiredStem, record.id, existingAudio);
    const markdownPath = nodePath.join(directory, `${stem}.md`);
    const audioPath = nodePath.join(directory, `${stem}.wav`);

    await this.moveAudioIfNeeded(existingAudio, audioPath);
    const audioFilePath = (await exists(audioPath)) ? audioPath : record.audioFilePath;
    const saved: MeetingRecord = { ...record, audioFilePath, sourcePath: markdownPath };

    await writeFileAtomic(markdownPath, renderMeetingMarkdown(saved));
    this.cache.delete(markdownPath);

    if (existing && !samePath(existing.path, markdownPath) && (await exists(existing.path))) {
      await this.unlink(existing.path);
      this.cache.delete(existing.path);
    }
    return saved;
  }

  /** How a delete removes one file. Only a delete uses this; a move's old file is just unlinked. */
  private removerFor(mode: MeetingDeleteMode): (path: string) => Promise<void> {
    const discard = this.options.discard;
    if (mode === 'permanent' || discard === undefined) return this.unlink;
    return async (path) => {
      try {
        await discard(path);
      } catch (error) {
        throw new MeetingTrashError(error instanceof Error ? error.message : String(error));
      }
    };
  }

  private async deleteLocked(id: string, mode: MeetingDeleteMode): Promise<void> {
    const remove = this.removerFor(mode);
    const entry = await this.pick(id);
    if (!entry || !(await exists(entry.path))) return;

    let storedAudio = '';
    try {
      storedAudio = (await this.parseFile(entry.path)).audioFilePath;
    } catch {
      // An unreadable file still goes; its sibling recording is found by name below.
    }
    // The recording goes first: if it is locked this throws while the markdown still exists, so
    // the meeting stays listed and the delete can be retried.
    // B25: a stored path outside the Library is never deleted, only logged.
    if (storedAudio.trim() !== '' && (await exists(storedAudio))) {
      if (isUnder(storedAudio, this.root)) await remove(storedAudio);
      else this.options.logger?.warn('left a recording outside the library in place', { id });
    }
    const sibling = siblingWavPath(entry.path);
    if (await exists(sibling)) await remove(sibling);
    await remove(entry.path);
    this.cache.delete(entry.path);
  }

  // ---------------------------------------------------------------- helpers

  private lockKey(): string {
    return `meetings:${lockKeyFor(this.root)}`;
  }

  /** A damaged `folders.json` must not stop meetings from being saved (B5). */
  private async folderList(): Promise<FolderRecord[]> {
    try {
      return await this.options.folders.getAll();
    } catch (error) {
      if (!(error instanceof LibraryFileCorruptError)) throw error;
      this.options.logger?.warn('folders.json is damaged; filing by Inbox for now', {
        error: error.message,
      });
      return [];
    }
  }

  private isLegacyFlatDump(path: string): boolean {
    const rel = nodePath.relative(this.root, path);
    const first = rel.split(/[\\/]/)[0]?.toLowerCase();
    return first === 'meetings' || first === 'recordings';
  }

  /**
   * B10: WinUI reserves only "Inbox", so its top-level folder "Meetings" or "Recordings" has
   * the directory `Library/Meetings`. A file there that belongs to that folder is not a dump.
   */
  private async isUserFolderDirectory(path: string, record: MeetingRecord): Promise<boolean> {
    const first = nodePath.relative(this.root, path).split(/[\\/]/)[0]?.toLowerCase();
    const top = folderChain(await this.folderList(), record.folderId)[0];
    return top !== undefined && sanitizeName(top.name).toLowerCase() === first;
  }

  /** Spec 3.6 step 4 and B2: a recording the saving meeting already owns does not force " 2". */
  private async allocateStem(
    directory: string,
    desired: string,
    meetingId: string,
    ownedAudio: string,
  ): Promise<string> {
    await fs.mkdir(directory, { recursive: true });
    for (let n = 1; ; n += 1) {
      const stem = n === 1 ? desired : `${desired} ${n}`;
      const markdown = nodePath.join(directory, `${stem}.md`);
      const audio = nodePath.join(directory, `${stem}.wav`);
      if (await exists(markdown)) {
        if ((await this.idAt(markdown)) === meetingId) return stem;
        continue;
      }
      if (!(await exists(audio))) return stem;
      if (ownedAudio.trim() !== '' && samePath(ownedAudio, audio)) return stem;
    }
  }

  private async idAt(path: string): Promise<string | null> {
    const cached = this.cache.get(path);
    if (cached?.item) return cached.item.id;
    try {
      return (await this.parseFile(path)).id;
    } catch (error) {
      if (error instanceof MeetingFormatError || this.isSkippable(error)) return null;
      throw error;
    }
  }

  private async moveAudioIfNeeded(source: string, destination: string): Promise<void> {
    if (source.trim() === '' || samePath(source, destination)) return;
    if (!(await exists(source))) return;
    await moveFile(source, destination, this.rename);
  }

  private async parseFile(path: string): Promise<MeetingRecord> {
    const text = await fs.readFile(path, 'utf8');
    return parseMeetingMarkdown(path, text, probe);
  }

  private isSkippable(error: unknown): boolean {
    const code = errorCode(error);
    return code === 'EACCES' || code === 'EPERM' || code === 'EBUSY' || code === 'ENOENT';
  }

  /** Which of two files with one id is the meeting: current layout, then newest, then path. */
  private prefer(candidate: IndexEntry, kept: IndexEntry): boolean {
    if (candidate.legacy !== kept.legacy) return !candidate.legacy;
    if (candidate.mtimeMs !== kept.mtimeMs) return candidate.mtimeMs > kept.mtimeMs;
    return candidate.path < kept.path;
  }

  private async pick(id: string): Promise<IndexEntry | undefined> {
    let best: IndexEntry | undefined;
    for (const entry of await this.scan()) {
      if (entry.item?.id !== id) continue;
      if (best === undefined || this.prefer(entry, best)) best = entry;
    }
    return best;
  }

  /** Stats every markdown file and re-reads only those that changed since the last scan. */
  private async scan(): Promise<IndexEntry[]> {
    const files = await listMarkdownFiles(this.root);
    const fresh = new Map<string, IndexEntry>();
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let index = next++; index < files.length; index = next++) {
        const path = files[index];
        if (path === undefined) continue;
        const entry = await this.indexFile(path);
        if (entry) fresh.set(path, entry);
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, files.length) }, worker));
    this.cache.clear();
    for (const [path, entry] of fresh) this.cache.set(path, entry);
    return [...fresh.values()];
  }

  private async indexFile(path: string): Promise<IndexEntry | undefined> {
    let stat;
    try {
      stat = await fs.stat(path);
    } catch (error) {
      if (this.isSkippable(error)) return undefined;
      throw error;
    }
    const cached = this.cache.get(path);
    if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;

    let legacy = this.isLegacyFlatDump(path);
    try {
      const record = await this.parseFile(path);
      if (legacy && (await this.isUserFolderDirectory(path, record))) legacy = false;
      return {
        path,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        legacy,
        skipReason: null,
        item: meetingListItem(record),
      };
    } catch (error) {
      if (error instanceof MeetingFormatError) {
        return {
          path,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          legacy,
          item: null,
          skipReason: error.message,
        };
      }
      if (this.isSkippable(error)) {
        // Unreadable right now; not cached by time, so the next scan tries again.
        return {
          path,
          mtimeMs: -1,
          size: -1,
          legacy,
          item: null,
          skipReason: String(errorCode(error)),
        };
      }
      throw error;
    }
  }
}
