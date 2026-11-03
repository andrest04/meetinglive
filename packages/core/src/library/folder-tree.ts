import type { FolderRecord } from './folder';
import { folderDirectoryName } from './names';

export const MAX_CHAIN_STEPS = 64;

/** Folders from the root down to `folderId`. Stops at a missing parent or after 64 steps. */
export function folderChain(
  folders: readonly FolderRecord[],
  folderId: string | null,
): FolderRecord[] {
  if (folderId === null) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderRecord[] = [];
  let current = byId.get(folderId);
  while (current && chain.length < MAX_CHAIN_STEPS) {
    chain.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return chain;
}

/** Directory path segments under the Library root. An empty chain is Inbox. */
export function folderDirectorySegments(
  folders: readonly FolderRecord[],
  folderId: string | null,
): string[] {
  const chain = folderChain(folders, folderId);
  return chain.length === 0 ? ['Inbox'] : chain.map((f) => folderDirectoryName(f.name));
}

/** Name order: case-insensitive, accent-sensitive, by the given locale (B24: never the machine's). */
export function nameComparer(locale?: string): (a: string, b: string) => number {
  const collator = new Intl.Collator(locale, { sensitivity: 'accent' });
  return (a, b) => collator.compare(a, b);
}

export interface FolderNode {
  readonly folder: FolderRecord;
  readonly children: readonly FolderNode[];
}

/** The folder tree. Roots are folders with no parent; folders under a missing parent are left out. */
export function buildFolderTree(folders: readonly FolderRecord[], locale?: string): FolderNode[] {
  const compare = nameComparer(locale);
  const childrenOf = new Map<string | null, FolderRecord[]>();
  for (const folder of folders) {
    const list = childrenOf.get(folder.parentId) ?? [];
    list.push(folder);
    childrenOf.set(folder.parentId, list);
  }
  const build = (parentId: string | null, visited: ReadonlySet<string>): FolderNode[] =>
    (childrenOf.get(parentId) ?? [])
      .filter((f) => !visited.has(f.id))
      .sort((a, b) => compare(a.name, b.name))
      .map((folder) => ({
        folder,
        children: build(folder.id, new Set([...visited, folder.id])),
      }));
  return build(null, new Set());
}

export interface MoveDestination {
  /** null is Inbox. */
  readonly folderId: string | null;
  readonly path: string;
}

/** Inbox first, then every folder as `Parent / Child`, depth first (spec 3.11). */
export function flattenFolderPaths(
  folders: readonly FolderRecord[],
  inboxLabel: string,
  locale?: string,
): MoveDestination[] {
  if (inboxLabel.trim() === '') throw new Error('The Inbox label must not be blank.');
  const result: MoveDestination[] = [{ folderId: null, path: inboxLabel }];
  const walk = (nodes: readonly FolderNode[], prefix: string | null): void => {
    for (const node of nodes) {
      const path = prefix === null ? node.folder.name : `${prefix} / ${node.folder.name}`;
      result.push({ folderId: node.folder.id, path });
      walk(node.children, path);
    }
  };
  walk(buildFolderTree(folders, locale), null);
  return result;
}

export interface Breadcrumb {
  /** null is the Inbox item. */
  readonly folderId: string | null;
}

/** Inbox, then the chain root to selected (spec 2.4). */
export function buildBreadcrumbs(
  folders: readonly FolderRecord[],
  selectedId: string | null,
): Breadcrumb[] {
  return [{ folderId: null }, ...folderChain(folders, selectedId).map((f) => ({ folderId: f.id }))];
}

/** Ids of the ancestors of the target: the only nodes a reload expands. */
export function expandedAncestors(
  folders: readonly FolderRecord[],
  targetId: string | null,
): Set<string> {
  const chain = folderChain(folders, targetId);
  return new Set(chain.slice(0, -1).map((f) => f.id));
}
