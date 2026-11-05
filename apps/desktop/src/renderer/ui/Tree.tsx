import { ChevronRight } from 'lucide-react';
import {
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { ContextMenu, type MenuEntry } from './Menu';
import { flattenVisible, handleTreeKey, type TreeNode } from './tree-navigation';

export type { TreeNode } from './tree-navigation';

export interface TreeProps {
  readonly nodes: readonly TreeNode[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  /** Accessible name of the tree. */
  readonly label: string;
  readonly defaultExpandedIds?: readonly string[];
  /** Controlled expansion. When given, the tree only reports changes through `onExpandedChange`. */
  readonly expandedIds?: ReadonlySet<string>;
  readonly onExpandedChange?: (ids: ReadonlySet<string>) => void;
  /** Right click or the Menu key on a row. Return nothing for rows without a menu. */
  readonly nodeMenu?: (id: string) => readonly MenuEntry[] | undefined;
  /** A row with a menu is selected before the menu opens, unless this is false. */
  readonly selectOnContextMenu?: boolean;
  /** Extra attributes for a row, for example drop targets. The tree's own role and state win. */
  readonly rowProps?: (id: string) => HTMLAttributes<HTMLLIElement> | undefined;
  /** Drawn at the end of a row, for example a count. */
  readonly trailing?: (id: string) => ReactNode;
  readonly className?: string;
}

/** One tab stop for the whole tree; arrows move inside it. Rows are rendered flat with aria-level. */
export function Tree({
  nodes,
  selectedId,
  onSelect,
  label,
  defaultExpandedIds = [],
  expandedIds: controlledIds,
  onExpandedChange,
  nodeMenu,
  selectOnContextMenu = true,
  rowProps: extraRowProps,
  trailing,
  className,
}: TreeProps) {
  const [ownIds, setOwnIds] = useState<ReadonlySet<string>>(() => new Set(defaultExpandedIds));
  const expandedIds = controlledIds ?? ownIds;
  const items = useMemo(() => flattenVisible(nodes, expandedIds), [nodes, expandedIds]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  // The tab stop is the focused row, else the selected row, else the first.
  const tabStopId =
    items.find((item) => item.node.id === focusedId)?.node.id ??
    items.find((item) => item.node.id === selectedId)?.node.id ??
    items[0]?.node.id;

  const setExpanded = (id: string, expanded: boolean): void => {
    const next = new Set(expandedIds);
    if (expanded) next.add(id);
    else next.delete(id);
    if (controlledIds === undefined) setOwnIds(next);
    onExpandedChange?.(next);
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
        const extra = extraRowProps?.(item.node.id);
        const end = trailing?.(item.node.id);
        const rowProps = {
          ...extra,
          role: 'treeitem',
          'aria-level': item.level,
          'aria-posinset': item.posInSet,
          'aria-setsize': item.setSize,
          'aria-selected': selected,
          'aria-expanded': item.expandable ? item.expanded : undefined,
          tabIndex: item.node.id === tabStopId ? 0 : -1,
          ref: (element: HTMLLIElement | null) => {
            if (element) rowRefs.current.set(item.node.id, element);
            else rowRefs.current.delete(item.node.id);
          },
          onFocus: () => {
            setFocusedId(item.node.id);
          },
          onClick: () => {
            onSelect(item.node.id);
          },
          style: { paddingInlineStart: `${String((item.level - 1) * 14 + 6)}px` },
          className: cn(
            'flex h-7 cursor-default items-center gap-1.5 rounded-control pe-2 text-ui-lg text-ink-muted select-none',
            'transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink',
            selected && 'bg-pressed font-medium text-ink',
            'forced-colors:aria-selected:bg-[Highlight] forced-colors:aria-selected:text-[HighlightText]',
            extra?.className,
          ),
        } as const;
        const content = (
          <>
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
            {item.node.accent !== undefined ? (
              <span
                aria-hidden="true"
                style={
                  item.node.accent === null ? undefined : { backgroundColor: item.node.accent }
                }
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  item.node.accent === null && 'invisible',
                  'forced-colors:bg-[CanvasText]',
                )}
              />
            ) : null}
            {item.node.icon ? (
              <Icon
                icon={item.node.icon}
                size={14}
                style={item.node.accent ? { color: item.node.accent } : undefined}
              />
            ) : null}
            <span className="truncate">{item.node.label}</span>
            {/* The space keeps the end text a separate word in the accessible name. */}
            {end ? <> {end}</> : null}
          </>
        );
        const menu = nodeMenu?.(item.node.id);
        return menu && menu.length > 0 ? (
          <ContextMenu
            key={item.node.id}
            entries={menu}
            render={
              <li
                {...rowProps}
                // A row with a menu is selected first, so the menu acts on what is selected.
                onContextMenu={() => {
                  if (selectOnContextMenu && !selected) onSelect(item.node.id);
                }}
              />
            }
          >
            {content}
          </ContextMenu>
        ) : (
          <li key={item.node.id} {...rowProps}>
            {content}
          </li>
        );
      })}
    </ul>
  );
}
