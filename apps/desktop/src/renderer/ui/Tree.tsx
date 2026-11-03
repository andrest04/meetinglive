import { ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { flattenVisible, handleTreeKey, type TreeNode } from './tree-navigation';

export type { TreeNode } from './tree-navigation';

export interface TreeProps {
  readonly nodes: readonly TreeNode[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** Accessible name of the tree. */
  readonly label: string;
  readonly defaultExpandedIds?: readonly string[];
  readonly className?: string;
}

/** One tab stop for the whole tree; arrows move inside it. Rows are rendered flat with aria-level. */
export function Tree({
  nodes,
  selectedId,
  onSelect,
  label,
  defaultExpandedIds = [],
  className,
}: TreeProps) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(defaultExpandedIds),
  );
  const items = useMemo(() => flattenVisible(nodes, expandedIds), [nodes, expandedIds]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  // The tab stop is the focused row, else the selected row, else the first.
  const tabStopId =
    items.find((item) => item.node.id === focusedId)?.node.id ??
    items.find((item) => item.node.id === selectedId)?.node.id ??
    items[0]?.node.id;

  const setExpanded = (id: string, expanded: boolean): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (expanded) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const focusRow = (id: string): void => {
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || !tabStopId) return;
    const result = handleTreeKey(event.key, items, tabStopId);
    if (!result) return;
    event.preventDefault();
    if (result.setExpanded) setExpanded(result.setExpanded.id, result.setExpanded.expanded);
    if (result.focusId) focusRow(result.focusId);
    if (result.select) onSelect(result.select);
  };

  return (
    <ul
      role="tree"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex flex-col gap-px', className)}
    >
      {items.map((item) => {
        const selected = item.node.id === selectedId;
        return (
          <li
            key={item.node.id}
            ref={(element) => {
              if (element) rowRefs.current.set(item.node.id, element);
              else rowRefs.current.delete(item.node.id);
            }}
            role="treeitem"
            aria-level={item.level}
            aria-posinset={item.posInSet}
            aria-setsize={item.setSize}
            aria-selected={selected}
            aria-expanded={item.expandable ? item.expanded : undefined}
            tabIndex={item.node.id === tabStopId ? 0 : -1}
            onFocus={() => {
              setFocusedId(item.node.id);
            }}
            onClick={() => {
              onSelect(item.node.id);
            }}
            style={{ paddingInlineStart: `${String((item.level - 1) * 14 + 6)}px` }}
            className={cn(
              'flex h-7 cursor-default items-center gap-1.5 rounded-control pe-2 text-ui-lg text-ink-muted select-none',
              'transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink',
              selected && 'bg-pressed font-medium text-ink',
              'forced-colors:aria-selected:bg-[Highlight] forced-colors:aria-selected:text-[HighlightText]',
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-4 items-center justify-center"
              onClick={(event) => {
                if (!item.expandable) return;
                event.stopPropagation();
                setExpanded(item.node.id, !item.expanded);
              }}
            >
              {item.expandable ? (
                <Icon
                  icon={ChevronRight}
                  size={12}
                  className={cn(
                    'transition-transform duration-150 ease-out-quick',
                    item.expanded && 'rotate-90',
                  )}
                />
              ) : null}
            </span>
            {item.node.icon ? <Icon icon={item.node.icon} size={14} /> : null}
            <span className="truncate">{item.node.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
