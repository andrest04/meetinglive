/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildFolderTree } from '@vozella/core';
import {
  ACCENT_KEYS,
  FOLDER_ICONS,
  ICON_KEYS,
  INBOX_NODE_ID,
  accentColor,
  folderIcon,
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

describe('brand tokens and icons', () => {
  const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
  const accents = [...ACCENT_KEYS, 'neutral'];

  it('item 78: every accent token, and neutral, is defined in light, dark and forced colors', () => {
    // Light root, dark media query, dark attribute, forced colors: four blocks.
    for (const key of accents) {
      const defined = css.match(new RegExp('--accent-' + key + ':', 'g')) ?? [];
      expect(defined.length, key).toBe(4);
    }
  });

  it('item 77: each icon key has its own component, and an unset key draws the folder icon', () => {
    const components = ICON_KEYS.map((key) => FOLDER_ICONS[key]);
    expect(new Set(components).size).toBe(ICON_KEYS.length);
    expect(folderIcon({ id: 'x', colorKey: null, iconKey: null })).toBe(FOLDER_ICONS.folder);
    expect(folderIcon({ id: 'x', colorKey: null, iconKey: 'nope' })).toBe(FOLDER_ICONS.folder);
  });
});
