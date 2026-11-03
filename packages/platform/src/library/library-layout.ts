import fs from 'node:fs/promises';
import nodePath from 'node:path';
import { folderDirectorySegments, siblingWavPath, type FolderRecord } from '@vozella/core';

/** Directory of a folder under the Library root. Unknown or null folders are Inbox. */
export function directoryFor(
  libraryRoot: string,
  folders: readonly FolderRecord[],
  folderId: string | null,
): string {
  return nodePath.join(libraryRoot, ...folderDirectorySegments(folders, folderId));
}

/** Windows and macOS volumes ignore case by default; comparing paths must too. */
export function samePath(a: string, b: string): boolean {
  const left = nodePath.resolve(a);
  const right = nodePath.resolve(b);
  return process.platform === 'linux' ? left === right : left.toLowerCase() === right.toLowerCase();
}

export function isUnder(child: string, parent: string): boolean {
  const rel = nodePath.relative(nodePath.resolve(parent), nodePath.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !nodePath.isAbsolute(rel);
}

export async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Every `*.md` under `root`, at any depth. A missing root is an empty list. */
export async function listMarkdownFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return;
      throw error;
    }
    for (const entry of entries) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) found.push(full);
    }
  };
  await walk(root);
  return found;
}

/** Moves a file, copying when the volumes differ. Replaces a file at the destination. */
export async function moveFile(
  from: string,
  to: string,
  rename: (from: string, to: string) => Promise<void> = fs.rename,
): Promise<void> {
  await fs.mkdir(nodePath.dirname(to), { recursive: true });
  await fs.rm(to, { force: true });
  try {
    await rename(from, to);
  } catch (error) {
    if (errorCode(error) !== 'EXDEV') throw error;
    await fs.copyFile(from, to);
    await fs.unlink(from);
  }
}

export { siblingWavPath };
