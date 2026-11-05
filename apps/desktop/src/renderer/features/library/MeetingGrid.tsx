import type { MeetingListItemDto } from '@vozella/contracts';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { Ellipsis, FileText, FolderInput, Trash } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { ContextMenu, IconButton, Menu, cn, type MenuEntry } from '../../ui';
import { formatDayHeader, formatMeetingDate, formatMeetingTime } from './format';
import { highlightParts, type SearchHits } from './search-results';
import {
  activeHeaderIndex,
  buildGridItems,
  durationMinutes,
  HEADER_ROW_PX,
  MEETING_ROW_PX,
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
}

export interface MeetingGridProps {
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
  readonly onCursorChange: (id: string) => void;
  readonly onScrollOffsetChange: (offset: number) => void;
  readonly onOpen: (id: string) => void;
  readonly onOpenSummary: (id: string) => void;
  readonly onMove: (meeting: MeetingListItemDto) => void;
  readonly onDelete: (meeting: MeetingListItemDto) => void;
}

const COLUMN_COUNT = 3;

/**
 * The logbook: newest first, one sticky header per day, and each row ruled at its bottom in
 * proportion to the meeting's length. One tab stop for the rows; arrows move inside the grid, and
 * Tab goes on to the actions of the row the cursor is on.
 */
export function MeetingGrid({
  meetings,
  locale,
  labels,
  query,
  hits,
  cursorId,
  initialScrollOffset,
  clickOpens,
  onCursorChange,
  onScrollOffsetChange,
  onOpen,
  onOpenSummary,
  onMove,
  onDelete,
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

  const activeHeader = useRef<number | null>(null);
  const rangeExtractor = useCallback(
    (range: Range): number[] => {
      activeHeader.current = activeHeaderIndex(items, range.startIndex);
      // The sticky header and the focused row stay rendered, so neither focus nor context is lost
      // when the row scrolls out of the window.
      return withPinned(defaultRangeExtractor(range), [activeHeader.current, cursorIndex]);
    },
    [items, cursorIndex],
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

  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const rows = scrollerRef.current?.querySelectorAll<HTMLElement>('[data-row-id]') ?? [];
    for (const row of rows) {
      if (row.dataset.rowId === cursorId) {
        row.focus({ preventScroll: true });
        return;
      }
    }
  }, [cursorId]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    // Menus are portals: their keys bubble here through React, and they are not the grid's.
    const target = event.target as HTMLElement;
    const row = target.dataset.rowId;
    if (row === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(row);
      return;
    }
    const next = movedIndex(items, cursorIndex ?? tabStopIndex, event.key);
    if (next === null) return;
    event.preventDefault();
    const item = items[next];
    if (item?.kind !== 'meeting') return;
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
            />
          ) : (
            <MeetingRow
              key={virtual.key}
              meeting={item.meeting}
              locale={locale}
              labels={labels}
              query={query}
              snippet={hits.get(item.meeting.id)?.snippet ?? item.meeting.snippet}
              rowIndex={virtual.index + 1}
              offset={virtual.start}
              isCursor={virtual.index === cursorIndex}
              isTabStop={virtual.index === tabStopIndex}
              clickOpens={clickOpens}
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

function DayHeader({
  item,
  rowIndex,
  sticky,
  offset,
}: {
  readonly item: Extract<GridItem, { kind: 'header' }>;
  readonly rowIndex: number;
  readonly sticky: boolean;
  readonly offset: number;
}) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      data-sticky={sticky ? 'true' : undefined}
      style={sticky ? undefined : { transform: `translateY(${String(offset)}px)` }}
      className={cn(
        'flex h-8 w-full items-center border-b border-hairline bg-paper px-4',
        sticky ? 'sticky top-0 z-10' : 'absolute start-0 top-0',
      )}
    >
      <div
        role="rowheader"
        aria-colspan={COLUMN_COUNT}
        className="truncate text-ui font-medium text-ink"
      >
        {item.label}
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
    onCursorChange(meeting.id);
    if (clickOpens) onOpen(meeting.id);
  };
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    if (isRowClick(event) && !clickOpens) onOpen(meeting.id);
  };
  return (
    <ContextMenu
      entries={entries}
      render={
        <div
          role="row"
          aria-rowindex={rowIndex}
          aria-selected={false}
          tabIndex={isTabStop ? 0 : -1}
          data-row-id={meeting.id}
          data-cursor={isCursor ? 'true' : undefined}
          style={{ transform: `translateY(${String(offset)}px)` }}
          onClick={onClick}
          onDoubleClick={onDoubleClick}
          onFocus={(event) => {
            if (event.currentTarget.contains(event.target)) onCursorChange(meeting.id);
          }}
        />
      }
      className={cn(
        'group absolute start-0 top-0 flex h-16 w-full cursor-default items-stretch border-b border-hairline ps-4 pe-1.5 outline-offset-[-2px] select-none',
        'transition-colors duration-150 ease-out-quick hover:bg-hover',
        'data-cursor:bg-pressed forced-colors:data-cursor:bg-[Highlight] forced-colors:data-cursor:text-[HighlightText]',
      )}
    >
      <div
        role="gridcell"
        className="tabular flex w-16 shrink-0 flex-col justify-center font-mono text-caption/5 text-ink-faint group-data-cursor:text-ink-muted forced-colors:text-[CanvasText]"
      >
        <time dateTime={meeting.recordedAt} title={formatMeetingDate(meeting.recordedAt, locale)}>
          {formatMeetingTime(meeting.recordedAt, locale)}
        </time>
        {minutes === null ? null : <span>{labels.duration(minutes)}</span>}
      </div>
      <div role="gridcell" className="flex min-w-0 flex-1 flex-col justify-center">
        <span data-title className="truncate text-ui-lg font-medium text-ink">
          <Highlighted text={meeting.title} query={query} />
        </span>
        <span className="truncate text-ui text-ink-muted">
          {snippet === '' ? labels.noContent : <Highlighted text={snippet} query={query} />}
        </span>
      </div>
      <div role="gridcell" className="flex shrink-0 items-center">
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
          className="absolute start-0 -bottom-px h-px bg-ink-muted forced-colors:bg-[CanvasText]"
        />
      )}
    </ContextMenu>
  );
}
