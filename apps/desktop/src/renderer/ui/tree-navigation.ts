import type { LucideIcon } from 'lucide-react';

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly icon?: LucideIcon;
  /** A small colored dot before the icon. A color; `null` keeps the space empty so names align. */
  readonly accent?: string | null;
  readonly children?: readonly TreeNode[];
}

export interface VisibleItem {
  readonly node: TreeNode;
  readonly level: number;
  readonly parentId: string | null;
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly posInSet: number;
  readonly setSize: number;
}

/** The rows a user can currently reach: children appear only under expanded parents. */
export function flattenVisible(
  nodes: readonly TreeNode[],
  expandedIds: ReadonlySet<string>,
  level = 1,
  parentId: string | null = null,
): VisibleItem[] {
  const rows: VisibleItem[] = [];
  nodes.forEach((node, index) => {
    const expandable = (node.children?.length ?? 0) > 0;
    const expanded = expandable && expandedIds.has(node.id);
    rows.push({
      node,
      level,
      parentId,
      expandable,
      expanded,
      posInSet: index + 1,
      setSize: nodes.length,
    });
    if (expanded && node.children) {
      rows.push(...flattenVisible(node.children, expandedIds, level + 1, node.id));
    }
  });
  return rows;
}

export interface TreeKeyResult {
  readonly focusId?: string;
  readonly setExpanded?: { readonly id: string; readonly expanded: boolean };
  readonly select?: string;
}

/**
 * Keyboard model from the ARIA authoring practices tree pattern: Up and Down move,
 * Right opens or enters, Left closes or goes to the parent, Home and End jump,
 * Enter and Space select, a printable character jumps to the next label that starts with it.
 * Returns null when the key is not handled so the caller leaves it alone.
 */
export function handleTreeKey(
  key: string,
  items: readonly VisibleItem[],
  focusedId: string,
): TreeKeyResult | null {
  const index = items.findIndex((item) => item.node.id === focusedId);
  const current = items[index];
  if (!current) return null;

  switch (key) {
    case 'ArrowDown': {
      const next = items[index + 1];
      return next ? { focusId: next.node.id } : {};
    }
    case 'ArrowUp': {
      const previous = items[index - 1];
      return previous ? { focusId: previous.node.id } : {};
    }
    case 'ArrowRight': {
      if (!current.expandable) return {};
      if (!current.expanded) return { setExpanded: { id: current.node.id, expanded: true } };
      const child = items[index + 1];
      return child ? { focusId: child.node.id } : {};
    }
    case 'ArrowLeft': {
      if (current.expanded) return { setExpanded: { id: current.node.id, expanded: false } };
      return current.parentId === null ? {} : { focusId: current.parentId };
    }
    case 'Home':
      return { focusId: items[0]?.node.id ?? focusedId };
    case 'End':
      return { focusId: items[items.length - 1]?.node.id ?? focusedId };
    case 'Enter':
    case ' ':
      return { select: current.node.id };
    default: {
      if (key.length !== 1 || key.trim() === '') return null;
      const needle = key.toLowerCase();
      const ordered = [...items.slice(index + 1), ...items.slice(0, index)];
      const match = ordered.find((item) => item.node.label.toLowerCase().startsWith(needle));
      return match ? { focusId: match.node.id } : {};
    }
  }
}
