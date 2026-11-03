import { describe, expect, it } from 'vitest';
import { buildFolderTree } from '@vozella/core';
import {
  ACCENT_KEYS,
  FOLDER_ICONS,
  ICON_KEYS,
  INBOX_NODE_ID,
  accentColor,
  buildTreeNodes,
} from './folder-visuals';
import { folderRecord } from './library-test-kit';

describe('folder visuals', () => {
  it('draws all 18 icon keys and all 7 accents from the spec', () => {
    expect(ICON_KEYS).toHaveLength(18);
    expect(Object.keys(FOLDER_ICONS).sort()).toEqual([...ICON_KEYS].sort());
    expect(ACCENT_KEYS).toEqual(['blue', 'teal', 'green', 'amber', 'orange', 'red', 'purple']);
    expect(accentColor('teal')).toBe('var(--accent-teal)');
  });

  it('puts the virtual Inbox first, with an empty accent slot, then folders by name', () => {
    const folders = [
      folderRecord('b', 'Zeta', null, { colorKey: 'red', iconKey: 'star' }),
      folderRecord('a', 'alfa'),
      folderRecord('c', 'Child', 'a'),
    ];
    const nodes = buildTreeNodes(buildFolderTree(folders, 'en'), 'Inbox');
    expect(nodes.map((n) => n.label)).toEqual(['Inbox', 'alfa', 'Zeta']);
    expect(nodes[0]).toMatchObject({ id: INBOX_NODE_ID, accent: null });
    expect(nodes[2]).toMatchObject({ accent: 'var(--accent-red)' });
    expect(nodes[1]?.children?.map((n) => n.label)).toEqual(['Child']);
  });
});
