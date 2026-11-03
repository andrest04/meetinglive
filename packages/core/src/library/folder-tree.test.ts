import { describe, expect, it } from 'vitest';
import type { FolderRecord } from './folder';
import {
  buildBreadcrumbs,
  buildFolderTree,
  expandedAncestors,
  flattenFolderPaths,
  folderChain,
  folderDirectorySegments,
} from './folder-tree';

const folder = (id: string, name: string, parentId: string | null = null): FolderRecord => ({
  id,
  name,
  parentId,
  note: null,
  colorKey: null,
  iconKey: null,
  createdAt: '2026-09-01T12:00:00-05:00',
});

describe('folderDirectorySegments', () => {
  it('is Inbox for null, unknown, or an empty chain', () => {
    expect(folderDirectorySegments([], null)).toEqual(['Inbox']);
    expect(folderDirectorySegments([folder('a', 'A')], 'zzz')).toEqual(['Inbox']);
  });

  it('joins sanitized names root to folder', () => {
    const folders = [folder('a', 'Universidad'), folder('b', 'Cal/culo', 'a')];
    expect(folderDirectorySegments(folders, 'b')).toEqual(['Universidad', 'Cal culo']);
  });

  it('keeps the partial path when a parent is missing', () => {
    const folders = [folder('b', 'Child', 'gone')];
    expect(folderDirectorySegments(folders, 'b')).toEqual(['Child']);
  });

  it('stops after 64 steps', () => {
    const folders: FolderRecord[] = [];
    for (let i = 0; i < 100; i += 1) {
      folders.push(folder(`f${i}`, `n${i}`, i === 0 ? null : `f${i - 1}`));
    }
    expect(folderChain(folders, 'f99')).toHaveLength(64);
  });

  it('survives a cycle', () => {
    const folders = [folder('a', 'A', 'b'), folder('b', 'B', 'a')];
    expect(folderChain(folders, 'a').length).toBeLessThanOrEqual(64);
  });
});

describe('flattenFolderPaths', () => {
  it('returns Inbox only for no folders', () => {
    expect(flattenFolderPaths([], 'Inbox')).toEqual([{ folderId: null, path: 'Inbox' }]);
  });

  it('sorts roots after Inbox and joins nested with " / "', () => {
    const folders = [
      folder('b', 'beta'),
      folder('a', 'Alpha'),
      folder('c', 'Child', 'a'),
      folder('d', 'Zed', 'a'),
    ];
    expect(flattenFolderPaths(folders, 'Inbox').map((r) => r.path)).toEqual([
      'Inbox',
      'Alpha',
      'Alpha / Child',
      'Alpha / Zed',
      'beta',
    ]);
  });

  it('rejects a blank inbox label', () => {
    expect(() => flattenFolderPaths([], '  ')).toThrow();
  });

  it('B24: ordering depends on the locale passed in, accents sort in place', () => {
    const folders = [folder('a', 'Ñu'), folder('b', 'Nz')];
    expect(flattenFolderPaths(folders, 'Inbox', 'es').map((r) => r.path)).toEqual([
      'Inbox',
      'Nz',
      'Ñu',
    ]);
  });

  it('does not emit folders whose parent chain never reaches a root', () => {
    const folders = [folder('b', 'Orphan', 'gone')];
    expect(flattenFolderPaths(folders, 'Inbox')).toHaveLength(1);
  });
});

describe('tree and breadcrumbs', () => {
  const folders = [
    folder('a', 'Universidad'),
    folder('c', 'Calculo', 'a'),
    folder('b', 'Trabajo'),
    folder('z', 'algebra', 'a'),
  ];

  it('builds children sorted by name, case-insensitive', () => {
    const tree = buildFolderTree(folders);
    expect(tree.map((n) => n.folder.name)).toEqual(['Trabajo', 'Universidad']);
    expect(tree[1]?.children.map((n) => n.folder.name)).toEqual(['algebra', 'Calculo']);
  });

  it('breadcrumbs start at Inbox and follow the chain', () => {
    expect(buildBreadcrumbs(folders, null)).toEqual([{ folderId: null }]);
    expect(buildBreadcrumbs(folders, 'c').map((b) => b.folderId)).toEqual([null, 'a', 'c']);
  });

  it('expands only the ancestors of the target', () => {
    expect([...expandedAncestors(folders, 'c')]).toEqual(['a']);
    expect([...expandedAncestors(folders, null)]).toEqual([]);
  });
});
