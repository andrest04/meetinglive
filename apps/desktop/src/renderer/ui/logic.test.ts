import { describe, expect, it } from 'vitest';
import { clampSize, sizeForDrag, sizeForKey } from './splitter-logic';
import { flattenVisible, handleTreeKey, type TreeNode } from './tree-navigation';

const nodes: TreeNode[] = [
  { id: 'inbox', label: 'Inbox' },
  {
    id: 'clients',
    label: 'Clients',
    children: [
      { id: 'acme', label: 'Acme' },
      { id: 'north', label: 'Northwind', children: [{ id: 'q', label: 'Quarterly' }] },
    ],
  },
  { id: 'team', label: 'Team' },
];

describe('flattenVisible', () => {
  it('shows children only under expanded parents, with levels and set positions', () => {
    const collapsed = flattenVisible(nodes, new Set());
    expect(collapsed.map((row) => row.node.id)).toEqual(['inbox', 'clients', 'team']);

    const open = flattenVisible(nodes, new Set(['clients']));
    expect(open.map((row) => [row.node.id, row.level])).toEqual([
      ['inbox', 1],
      ['clients', 1],
      ['acme', 2],
      ['north', 2],
      ['team', 1],
    ]);
    expect(open[3]).toMatchObject({ posInSet: 2, setSize: 2, parentId: 'clients' });
  });
});

describe('handleTreeKey', () => {
  const open = flattenVisible(nodes, new Set(['clients']));

  it('moves with the arrows and stops at the ends', () => {
    expect(handleTreeKey('ArrowDown', open, 'inbox')).toEqual({ focusId: 'clients' });
    expect(handleTreeKey('ArrowUp', open, 'clients')).toEqual({ focusId: 'inbox' });
    expect(handleTreeKey('ArrowUp', open, 'inbox')).toEqual({});
    expect(handleTreeKey('ArrowDown', open, 'team')).toEqual({});
  });

  it('opens with Right, enters the first child, closes with Left, goes to the parent', () => {
    const closed = flattenVisible(nodes, new Set());
    expect(handleTreeKey('ArrowRight', closed, 'clients')).toEqual({
      setExpanded: { id: 'clients', expanded: true },
    });
    expect(handleTreeKey('ArrowRight', open, 'clients')).toEqual({ focusId: 'acme' });
    expect(handleTreeKey('ArrowRight', open, 'inbox')).toEqual({});
    expect(handleTreeKey('ArrowLeft', open, 'clients')).toEqual({
      setExpanded: { id: 'clients', expanded: false },
    });
    expect(handleTreeKey('ArrowLeft', open, 'acme')).toEqual({ focusId: 'clients' });
    expect(handleTreeKey('ArrowLeft', open, 'inbox')).toEqual({});
  });

  it('jumps with Home, End and by first letter, and selects with Enter or Space', () => {
    expect(handleTreeKey('Home', open, 'team')).toEqual({ focusId: 'inbox' });
    expect(handleTreeKey('End', open, 'inbox')).toEqual({ focusId: 'team' });
    expect(handleTreeKey('t', open, 'inbox')).toEqual({ focusId: 'team' });
    expect(handleTreeKey('i', open, 'team')).toEqual({ focusId: 'inbox' });
    expect(handleTreeKey('Enter', open, 'acme')).toEqual({ select: 'acme' });
    expect(handleTreeKey(' ', open, 'acme')).toEqual({ select: 'acme' });
  });

  it('leaves other keys alone', () => {
    expect(handleTreeKey('Tab', open, 'inbox')).toBeNull();
    expect(handleTreeKey('F5', open, 'inbox')).toBeNull();
    expect(handleTreeKey('ArrowDown', open, 'missing')).toBeNull();
  });
});

describe('splitter logic', () => {
  const horizontal = { min: 100, max: 300, orientation: 'horizontal' as const };

  it('clamps, and tolerates a max below the min', () => {
    expect(clampSize(50, 100, 300)).toBe(100);
    expect(clampSize(500, 100, 300)).toBe(300);
    expect(clampSize(200, 100, 50)).toBe(100);
  });

  it('steps with the arrows for the orientation, bigger with Shift', () => {
    expect(sizeForKey('ArrowRight', false, 200, horizontal)).toBe(216);
    expect(sizeForKey('ArrowLeft', true, 200, horizontal)).toBe(136);
    expect(sizeForKey('ArrowDown', false, 200, horizontal)).toBeNull();
    expect(sizeForKey('ArrowDown', false, 200, { ...horizontal, orientation: 'vertical' })).toBe(
      216,
    );
  });

  it('never leaves the limits and jumps with Home and End', () => {
    expect(sizeForKey('ArrowRight', true, 290, horizontal)).toBe(300);
    expect(sizeForKey('Home', false, 200, horizontal)).toBe(100);
    expect(sizeForKey('End', false, 200, horizontal)).toBe(300);
    expect(sizeForKey('a', false, 200, horizontal)).toBeNull();
  });

  it('follows the pointer from where the drag started', () => {
    const limits = { min: 100, max: 300 };
    expect(sizeForDrag(200, 400, 450, limits)).toBe(250);
    expect(sizeForDrag(200, 400, 100, limits)).toBe(100);
    expect(sizeForDrag(200, 400, 900, limits)).toBe(300);
  });
});
