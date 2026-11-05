import type { MeetingListItemDto } from '@vozella/contracts';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { Check, Ellipsis, FileText, FolderInput, Minus, Trash } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from 'react';
import { matchLibraryShortcut } from '../../app/shortcuts';
import { ContextMenu, Icon, IconButton, Menu, cn, type MenuEntry } from '../../ui';
import { formatDayHeader, formatMeetingDate, formatMeetingTime } from './format';
import { gridKeyAction, type GridKeyAction } from './library-keys';
import { MEETINGS_DRAG_TYPE, setDragged, useLibraryStore } from './library-store';
import { groupState } from './library-selection';
import { highlightParts, snippetAroundMatch, type SearchHits } from './search-results';
import {
  activeHeaderIndex,
  buildGridItems,
  durationMinutes,
  HEADER_ROW_PX,
  MEETING_ROW_PX,
  meetingsOfDay,
  movedIndex,
  rulingWidthPx,
  withPinned,
  type GridItem,
} from './logbook';

export interface MeetingGridLabels {
  readonly grid: string;
  readonly noContent: string;
  readonly more: string;
  readonly openSummary: string;
  readonly move: string;
  readonly remove: string;
  readonly today: string;
  readonly yesterday: string;
  readonly noDate: string;
  readonly duration: (minutes: number) => string;
  readonly checkMeeting: (title: string) => string;
  readonly checkDay: (day: string) => string;
  readonly dragCount: (count: number) => string;
}

export interface MeetingGridHandle {
  /** Puts the focus on the cursor row. False when there is no row to take it. */
  readonly focusCursor: () => boolean;
}

export interface MeetingGridProps {
  readonly handle?: Ref<MeetingGridHandle>;
  readonly meetings: readonly MeetingListItemDto[];
  readonly locale: string;
  readonly labels: MeetingGridLabels;
  /** The search text, to mark in the rows, and what was found inside each meeting. */
  readonly query: string;
  readonly hits: SearchHits;
  readonly cursorId: string | null;
  readonly initialScrollOffset: number;
  /** With no preview beside the list, a click has nothing else to do but open. */
  readonly clickOpens: boolean;
  /** The checked meetings: `aria-selected` in the grid, and what the actions apply to. */
  readonly checked: ReadonlySet<string>;
  readonly onToggleCheck: (id: string) => void;
  /** A Shift range, from the cursor if no check is the anchor yet. */
  readonly onExtendChecks: (fromId: string, toId: string) => void;
  readonly onSetDayChecks: (ids: readonly string[], on: boolean) => void;
  readonly onCursorChange: (id: string) => void;
  readonly onScrollOffsetChange: (offset: number) => void;
  readonly onOpen: (id: string) => void;
  readonly onOpenSummary: (id: string) => void;
  readonly onMove: (meeting: MeetingListItemDto) => void;
  readonly onDelete: (meeting: MeetingListItemDto) => void;
  /** A key on a focused row, other than opening it and moving. */
  readonly onRowKey: (action: Exclude<GridKeyAction, 'open'>, id: string) => void;
  readonly onSelectAll: () => void;
}

const COLUMN_COUNT = 3;

/**
 * The logbook: newest first, one sticky header per day, and each row ruled at its bottom in
 * proportion to the meeting's length. One tab stop for the rows; arrows move inside the grid, and
 * Tab goes on to the actions of the row the cursor is on.
 */
export function MeetingGrid({
  handle,
  meetings,
  locale,
  labels,
  query,
  hits,
  cursorId,
  initialScrollOffset,
  clickOpens,
  checked,
  onToggleCheck,
  onExtendChecks,
  onSetDayChecks,
  onCursorChange,
  onScrollOffsetChange,
  onOpen,
  onOpenSummary,
  onMove,
  onDelete,
  onRowKey,
  onSelectAll,
}: MeetingGridProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    const now = Date.now();
    return buildGridItems(meetings, (ms) =>
      ms === null ? labels.noDate : formatDayHeader(ms, now, locale, labels),
    );
  }, [meetings, locale, labels]);

  const cursorIndex = useMemo(() => {
    const index = items.findIndex(
      (item) => item.kind === 'meeting' && item.meeting.id === cursorId,
    );
    return index === -1 ? null : index;
  }, [items, cursorId]);
  // The tab stop is the cursor row, else the first row of the list.
  const tabStopIndex = cursorIndex ?? (items[0]?.kind === 'header' ? 1 : 0);

  const draggedIds = useLibraryStore((state) => state.draggedIds);
  const draggedIndexes = useMemo(() => {
    if (draggedIds.length === 0) return [];
    const dragged = new Set(draggedIds);
    const indexes: number[] = [];
    items.forEach((item, index) => {
      if (item.kind === 'meeting' && dragged.has(item.meeting.id)) indexes.push(index);
    });
    return indexes;
  }, [items, draggedIds]);

  const activeHeader = useRef<number | null>(null);
  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      activeHeader.current = activeHeaderIndex(items, range.startIndex);
      // The sticky header and the focused row stay rendered, so neither focus nor context is lost
      // when the row scrolls out of the window. A row being dragged stays too: losing the source
      // element ends the drag.
      return withPinned(defaultRangeExtractor(range), [
        activeHeader.current,
        cursorIndex,
        ...draggedIndexes,
      ]);
    },
    [items, cursorIndex, draggedIndexes],
  );

  // Stable: the virtualizer redoes every measurement at each new identity of the key function.
  const getItemKey = useCallback(
    (index: number): string | number => {
      const item = items[index];
      if (!item) return index;
      return item.kind === 'header' ? item.key : item.meeting.id;
    },
    [items],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) => (items[index]?.kind === 'header' ? HEADER_ROW_PX : MEETING_ROW_PX),
    getItemKey,
    overscan: 6,
    rangeExtractor,
    initialOffset: initialScrollOffset,
    // A row brought into view by the keyboard must clear the sticky header (WCAG 2.4.11).
    scrollPaddingStart: HEADER_ROW_PX,
    onChange: (instance) => {
      onScrollOffsetChange(instance.scrollOffset ?? 0);
    },
  });

  const focusRow = useCallback((id: string | null): boolean => {
    const rows = scrollerRef.current?.querySelectorAll<HTMLElement>('[data-row-id]') ?? [];
    for (const row of rows) {
      if (row.dataset.rowId === id) {
        row.focus({ preventScroll: true });
        return true;
      }
    }
    return false;
  }, []);

  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    focusRow(cursorId);
  }, [cursorId, focusRow]);

  useImperativeHandle(
    handle,
    () => ({
      focusCursor: () => {
        const index = cursorIndex ?? tabStopIndex;
        const item = items[index];
        if (item?.kind !== 'meeting') return false;
        virtualizer.scrollToIndex(index, { align: 'auto' });
        if (item.meeting.id === cursorId) return focusRow(cursorId);
        pendingFocus.current = true;
        onCursorChange(item.meeting.id);
        return true;
      },
    }),
    [cursorId, cursorIndex, focusRow, items, onCursorChange, tabStopIndex, virtualizer],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Menus are portals: their keys bubble here through React, and they are not the grid's.
    const target = event.target as HTMLElement;
    const row = target.dataset.rowId;
    if (row === undefined) return;
    if (matchLibraryShortcut(event) === 'librarySelectAll') {
      event.preventDefault();
      onSelectAll();
      return;
    }
    const action = gridKeyAction(event);
    if (action !== null) {
      event.preventDefault();
      if (action === 'open') onOpen(row);
      else onRowKey(action, row);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const next = movedIndex(items, cursorIndex ?? tabStopIndex, event.key);
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (item?.kind !== 'meeting') return;
    if (event.shiftKey) onExtendChecks(row, item.meeting.id);
    pendingFocus.current = true;
    onCursorChange(item.meeting.id);
    virtualizer.scrollToIndex(next, { align: 'auto' });
  };

  const virtualItems = virtualizer.getVirtualItems();
  return (
    <div
      ref={scrollerRef}
      role="grid"
      aria-label={labels.grid}
      aria-multiselectable="true"
      aria-rowcount={items.length}
      aria-colcount={COLUMN_COUNT}
      onKeyDown={onKeyDown}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div
        role="rowgroup"
        style={{ height: virtualizer.getTotalSize() }}
        className="relative w-full"
      >
        {virtualItems.map((virtual) => {
          const item = items[virtual.index];
          if (!item) return null;
          return item.kind === 'header' ? (
            <DayHeader
              key={virtual.key}
              item={item}
              rowIndex={virtual.index + 1}
              sticky={virtual.index === activeHeader.current}
              offset={virtual.start}
              checkLabel={labels.checkDay(item.label)}
              anyChecked={checked.size > 0}
              checkState={groupState(checked, meetingsOfDay(items, virtual.index))}
              onToggle={() => {
                const ids = meetingsOfDay(items, virtual.index);
                onSetDayChecks(ids, groupState(checked, ids) !== true);
              }}
            />
          ) : (
            <MeetingRow
              key={virtual.key}
              meeting={item.meeting}
              locale={locale}
              labels={labels}
              query={query}
              snippet={snippetAroundMatch(
                hits.get(item.meeting.id)?.snippet ?? item.meeting.snippet,
                query,
              )}
              rowIndex={virtual.index + 1}
              offset={virtual.start}
              isCursor={virtual.index === cursorIndex}
              isTabStop={virtual.index === tabStopIndex}
              clickOpens={clickOpens}
              isChecked={checked.has(item.meeting.id)}
              anyChecked={checked.size > 0}
              onDragStart={(event) => {
                const ids = checked.has(item.meeting.id)
                  ? meetings.filter((m) => checked.has(m.id)).map((m) => m.id)
                  : [item.meeting.id];
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(MEETINGS_DRAG_TYPE, String(ids.length));
                if (ids.length > 1) setCountDragImage(event, labels.dragCount(ids.length));
                setDragged(ids);
              }}
              onDragEnd={() => {
                setDragged([]);
              }}
              onToggleCheck={onToggleCheck}
              onExtendChecks={(toId) => {
                onExtendChecks(cursorId ?? toId, toId);
              }}
              onCursorChange={onCursorChange}
              onOpen={onOpen}
              onOpenSummary={onOpenSummary}
              onMove={onMove}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * A check of the row or the day. Only the pointer and assistive tech reach it: the keyboard checks
 * with Space on the row, so the grid keeps its one tab stop. Pressing it leaves the focus where it
 * was, and the click stops here, so it does not count as a click on the row.
 */
function RowCheck({
  label,
  state,
  anyChecked,
  onToggle,
}: {
  readonly label: string;
  readonly state: boolean | 'mixed';
  readonly anyChecked: boolean;
  readonly onToggle: (event: MouseEvent<HTMLSpanElement>) => void;
}) {
  return (
    <span
      role="checkbox"
      aria-label={label}
      aria-checked={state}
      tabIndex={-1}
      title={label}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
      }}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center transition-opacity duration-150 ease-out-quick forced-colors:opacity-100',
        anyChecked || state !== false
          ? 'opacity-100'
          : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 items-center justify-center rounded-control border text-on-ink forced-colors:text-[HighlightText]',
          state === false
            ? 'border-border-control bg-paper'
            : 'border-ink bg-ink forced-colors:bg-[Highlight]',
        )}
      >
        {state === false ? null : <Icon icon={state === 'mixed' ? Minus : Check} size={12} />}
      </span>
    </span>
  );
}

function DayHeader({
  item,
  rowIndex,
  sticky,
  offset,
  checkLabel,
  checkState,
  anyChecked,
  onToggle,
}: {
  readonly item: Extract<GridItem, { kind: 'header' }>;
  readonly rowIndex: number;
  readonly sticky: boolean;
  readonly offset: number;
  readonly checkLabel: string;
  readonly checkState: boolean | 'mixed';
  readonly anyChecked: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      data-sticky={sticky ? 'true' : undefined}
      style={{
        height: HEADER_ROW_PX,
        ...(sticky ? {} : { transform: `translateY(${String(offset)}px)` }),
      }}
      className={cn(
        'group flex w-full items-center border-b border-hairline bg-paper ps-4 pe-1.5',
        sticky ? 'sticky top-0 z-10' : 'absolute start-0 top-0',
      )}
    >
      <div
        role="rowheader"
        aria-colspan={COLUMN_COUNT}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-ui font-medium text-ink"
      >
        <span className="truncate">{item.label}</span>
        {/* The margin is the width of the row's More actions, so the checks line up. */}
        <span className="me-8 flex">
          <RowCheck
            label={checkLabel}
            state={checkState}
            anyChecked={anyChecked}
            onToggle={onToggle}
          />
        </span>
      </div>
    </div>
  );
}

/** The cursor row is already `pressed`, so a mark there is told apart by its underline. */
function Highlighted({ text, query }: { readonly text: string; readonly query: string }) {
  if (query.trim() === '') return text;
  return highlightParts(text, query).map((part, index) =>
    part.mark ? (
      <mark
        key={index}
        className="rounded-[2px] bg-pressed text-inherit group-data-cursor:bg-transparent group-data-cursor:underline forced-colors:bg-[Mark] forced-colors:text-[MarkText]"
      >
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

/** Several rows drag as one small label with their count, in place of one row's picture. */
function setCountDragImage(event: DragEvent<HTMLDivElement>, text: string): void {
  const label = document.createElement('div');
  label.textContent = text;
  label.className =
    'fixed -top-96 start-0 rounded-control border border-hairline bg-paper-raised px-2 py-1 text-ui text-ink';
  document.body.append(label);
  event.dataTransfer.setDragImage(label, 12, 12);
  // The browser takes its picture right after this event.
  setTimeout(() => {
    label.remove();
  }, 0);
}

interface MeetingRowProps {
  readonly meeting: MeetingListItemDto;
  readonly locale: string;
  readonly labels: MeetingGridLabels;
  readonly query: string;
  readonly snippet: string;
  readonly rowIndex: number;
  readonly offset: number;
  readonly isCursor: boolean;
  readonly isTabStop: boolean;
  readonly clickOpens: boolean;
  readonly isChecked: boolean;
  readonly anyChecked: boolean;
  readonly onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  readonly onDragEnd: () => void;
  readonly onToggleCheck: (id: string) => void;
  readonly onExtendChecks: (toId: string) => void;
  readonly onCursorChange: (id: string) => void;
  readonly onOpen: (id: string) => void;
  readonly onOpenSummary: (id: string) => void;
  readonly onMove: (meeting: MeetingListItemDto) => void;
  readonly onDelete: (meeting: MeetingListItemDto) => void;
}

function MeetingRow({
  meeting,
  locale,
  labels,
  query,
  snippet,
  rowIndex,
  offset,
  isCursor,
  isTabStop,
  clickOpens,
  isChecked,
  anyChecked,
  onDragStart,
  onDragEnd,
  onToggleCheck,
  onExtendChecks,
  onCursorChange,
  onOpen,
  onOpenSummary,
  onMove,
  onDelete,
}: MeetingRowProps) {
  const minutes = durationMinutes(meeting.recordedAt, meeting.endedAt);
  const entries: MenuEntry[] = [
    {
      id: 'summary',
      label: labels.openSummary,
      icon: FileText,
      onSelect: () => {
        onOpenSummary(meeting.id);
      },
    },
    {
      id: 'move',
      label: labels.move,
      icon: FolderInput,
      onSelect: () => {
        onMove(meeting);
      },
    },
    {
      id: 'delete',
      label: labels.remove,
      icon: Trash,
      onSelect: () => {
        onDelete(meeting);
      },
    },
  ];
  // Menus are portals: their clicks bubble here through React, and they do not touch the row.
  const isRowClick = (event: MouseEvent<HTMLDivElement>): boolean => {
    const target = event.target as HTMLElement;
    return event.currentTarget.contains(target) && target.closest('button') === null;
  };
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (!isRowClick(event)) return;
    if (event.shiftKey) {
      onExtendChecks(meeting.id);
      onCursorChange(meeting.id);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      onToggleCheck(meeting.id);
      onCursorChange(meeting.id);
      return;
    }
    onCursorChange(meeting.id);
    if (clickOpens) onOpen(meeting.id);
  };
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey;
    if (isRowClick(event) && plain && !clickOpens) onOpen(meeting.id);
  };
  return (
    <ContextMenu
      entries={entries}
      render={
        <div
          role="row"
          aria-rowindex={rowIndex}
          aria-selected={isChecked}
          tabIndex={isTabStop ? 0 : -1}
          data-row-id={meeting.id}
          data-cursor={isCursor ? 'true' : undefined}
          style={{ height: MEETING_ROW_PX, transform: `translateY(${String(offset)}px)` }}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onFocus={(event) => {
            if (event.currentTarget.contains(event.target)) onCursorChange(meeting.id);
          }}
        />
      }
      className={cn(
        'group absolute start-0 top-0 flex w-full cursor-default items-stretch border-b border-hairline ps-4 outline-offset-[-2px] select-none',
        'transition-colors duration-150 ease-out-quick hover:bg-hover not-data-cursor:aria-selected:bg-hover',
        // A fill would sit under the backplate forced colors draws behind text, and hide the text.
        'data-cursor:bg-pressed forced-colors:data-cursor:outline-2 forced-colors:data-cursor:outline-[Highlight]',
      )}
    >
      <div
        role="gridcell"
        className="tabular flex w-[72px] shrink-0 flex-col justify-center font-mono text-caption/5 text-ink-faint group-hover:text-ink-muted group-aria-selected:text-ink-muted group-data-cursor:text-ink-muted forced-colors:text-[CanvasText]"
      >
        <time dateTime={meeting.recordedAt} title={formatMeetingDate(meeting.recordedAt, locale)}>
          {formatMeetingTime(meeting.recordedAt, locale)}
        </time>
        {minutes === null ? null : <span>{labels.duration(minutes)}</span>}
      </div>
      <div
        role="gridcell"
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center forced-colors:pe-[60px]',
          anyChecked ? 'pe-[60px]' : 'pe-3',
        )}
      >
        <span data-title className="truncate text-ui-lg font-medium text-ink">
          <Highlighted text={meeting.title} query={query} />
        </span>
        <span className="truncate text-ui text-ink-muted">
          {snippet === '' ? labels.noContent : <Highlighted text={snippet} query={query} />}
        </span>
      </div>
      {/* It covers the end of the text only while its controls show, so the text gets the width. */}
      <div
        role="gridcell"
        className={cn(
          'absolute inset-y-0 end-0 flex items-center ps-1 pe-1.5 transition-colors duration-150 ease-out-quick forced-colors:inset-y-[2px] forced-colors:end-[2px] forced-colors:bg-[Canvas] forced-colors:pe-1',
          isCursor
            ? 'bg-transparent group-focus-within:bg-[color-mix(in_srgb,var(--ink)_12%,var(--paper))] group-hover:bg-[color-mix(in_srgb,var(--ink)_12%,var(--paper))]'
            : 'group-focus-within:bg-[color-mix(in_srgb,var(--ink)_6%,var(--paper))] group-hover:bg-[color-mix(in_srgb,var(--ink)_6%,var(--paper))]',
        )}
      >
        <RowCheck
          label={labels.checkMeeting(meeting.title)}
          state={isChecked}
          anyChecked={anyChecked}
          onToggle={(event) => {
            if (event.shiftKey) onExtendChecks(meeting.id);
            else onToggleCheck(meeting.id);
          }}
        />
        <Menu
          align="end"
          entries={entries}
          trigger={
            <IconButton
              label={labels.more}
              icon={Ellipsis}
              tabIndex={isTabStop ? 0 : -1}
              className="opacity-0 transition-opacity duration-150 ease-out-quick group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 forced-colors:opacity-100"
            />
          }
        />
      </div>
      {minutes === null ? null : (
        <span
          aria-hidden="true"
          data-ruling
          style={{ width: rulingWidthPx(minutes) }}
          className="absolute start-0 -bottom-px h-[2px] bg-ink-muted forced-colors:bg-[CanvasText]"
        />
      )}
    </ContextMenu>
  );
}
