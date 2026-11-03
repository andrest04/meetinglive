import type { FolderRecord } from '@vozella/core';
import { describe, expect, it } from 'vitest';
import {
  buildDestinations,
  fromOptionValue,
  retainDestination,
  toOptionValue,
} from './destinations';

const folder = (id: string, name: string, parentId: string | null = null): FolderRecord => ({
  id,
  name,
  parentId,
  note: null,
  colorKey: null,
  iconKey: null,
  createdAt: '2026-09-01T12:00:00+00:00',
});

describe('buildDestinations (item 190)', () => {
  const folders = [
    folder('b', 'beta'),
    folder('a', 'Alpha'),
    folder('a2', 'zeta', 'a'),
    folder('a1', 'Child', 'a'),
  ];

  it('lists the Inbox first, then the tree depth first with case-insensitive order', () => {
    expect(buildDestinations(folders, 'Inbox', 'en').map((d) => d.path)).toEqual([
      'Inbox',
      'Alpha',
      'Alpha / Child',
      'Alpha / zeta',
      'beta',
    ]);
    expect(buildDestinations(folders, 'Inbox', 'en')[0]?.folderId).toBeNull();
  });

  it('keeps the selection while the folder exists and falls back to the Inbox', () => {
    const list = buildDestinations(folders, 'Inbox', 'en');
    expect(retainDestination('a1', list)).toBe('a1');
    expect(retainDestination('gone', list)).toBeNull();
    expect(retainDestination(null, list)).toBeNull();
  });

  it('maps the Inbox to a select value and back', () => {
    expect(fromOptionValue(toOptionValue(null))).toBeNull();
    expect(fromOptionValue(toOptionValue('x'))).toBe('x');
  });
});
