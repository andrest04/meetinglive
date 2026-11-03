import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  parseFoldersJson,
  serializeFolders,
  siblingWavPath,
  stripBom,
  type FolderRecord,
  type FolderRepository,
  type Logger,
} from '@vozella/core';
import { writeFileAtomic } from '../fs/atomic-write';
import { fileLocks, lockKeyFor, type KeyedMutex } from '../fs/keyed-mutex';
import { directoryFor, errorCode, exists, listMarkdownFiles, samePath } from './library-layout';

export interface JsonFolderRepositoryOptions {
  /** `<Library>/folders.json`. The Library root is its folder. */
  readonly foldersFilePath: string;
  readonly logger?: Logger;
  /** Defaults to the process-wide table, so every instance over one file shares one lock (B6). */
  readonly locks?: KeyedMutex;
}

/**
 * `folders.json` plus the directory mirror (spec 3.12). Directory work happens before the JSON
 * write, so a failed move leaves the JSON as it was.
 */
export class JsonFolderRepository implements FolderRepository {
  private readonly root: string;
  private readonly locks: KeyedMutex;

  constructor(private readonly options: JsonFolderRepositoryOptions) {
    this.root = nodePath.dirname(options.foldersFilePath);
    this.locks = options.locks ?? fileLocks;
  }

  getAll(): Promise<FolderRecord[]> {
    return this.locked(() => this.read());
  }

  save(folder: FolderRecord): Promise<void> {
    return this.locked(async () => {
      const folders = await this.read();
      const index = folders.findIndex((f) => f.id === folder.id);
      const previous = index >= 0 ? folders[index] : undefined;
      const previousDir = previous ? directoryFor(this.root, folders, previous.id) : null;

      const next = [...folders];
      if (index >= 0) next[index] = folder;
      else next.push(folder);
      const nextDir = directoryFor(this.root, next, folder.id);

      await this.syncDirectory(previousDir, nextDir);
      await writeFileAtomic(this.options.foldersFilePath, serializeFolders(next));
    });
  }

  delete(id: string): Promise<void> {
    return this.locked(async () => {
      const folders = await this.read();
      if (!folders.some((f) => f.id === id)) return;
      const directory = directoryFor(this.root, folders, id);
      const remaining = folders.filter((f) => f.id !== id);
      await writeFileAtomic(this.options.foldersFilePath, serializeFolders(remaining));
      try {
        await fs.rmdir(directory);
      } catch {
        // Not empty, already gone, or in use: leaving the directory is always safe.
      }
    });
  }

  private locked<T>(work: () => Promise<T>): Promise<T> {
    return this.locks.run(lockKeyFor(this.options.foldersFilePath), work);
  }

  private async read(): Promise<FolderRecord[]> {
    let text: string;
    try {
      text = await fs.readFile(this.options.foldersFilePath, 'utf8');
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
    return parseFoldersJson(text);
  }

  private async syncDirectory(previousDir: string | null, nextDir: string): Promise<void> {
    const moved =
      previousDir !== null &&
      previousDir !== nextDir &&
      (await exists(previousDir)) &&
      // Case-only renames land on the same directory in the file system; that is still a move.
      (samePath(previousDir, nextDir) || !(await exists(nextDir)));
    if (previousDir !== null && moved) {
      await fs.mkdir(nodePath.dirname(nextDir), { recursive: true });
      await fs.rename(previousDir, nextDir);
      await this.rewriteSiblingAudioPaths(nextDir);
      return;
    }
    if (previousDir !== null && previousDir !== nextDir && (await exists(previousDir))) {
      this.options.logger?.warn('folder directory already exists; meetings stay where they are', {
        nextDir,
      });
    }
    await fs.mkdir(nextDir, { recursive: true });
  }

  /**
   * After a directory move, point each meeting's `audioFilePath` at the recording beside it.
   * B9: only meetings that have such a recording are touched; a meeting with no audio, or with
   * audio stored elsewhere, keeps what it had.
   */
  private async rewriteSiblingAudioPaths(directory: string): Promise<void> {
    for (const markdownPath of await listMarkdownFiles(directory)) {
      const wav = siblingWavPath(markdownPath);
      if (!(await exists(wav))) continue;
      const text = stripBom(await fs.readFile(markdownPath, 'utf8'));
      const newline = text.includes('\r\n') ? '\r\n' : '\n';
      const lines = text.split(newline);
      const close = lines.indexOf('---', 1);
      const head = close < 0 ? lines : lines.slice(0, close);
      const at = head.findIndex((line) => line.startsWith('audioFilePath: '));
      if (at < 0) continue;
      const rewritten = `audioFilePath: ${wav}`;
      if (lines[at] === rewritten) continue;
      lines[at] = rewritten;
      await writeFileAtomic(markdownPath, lines.join(newline));
    }
  }
}
