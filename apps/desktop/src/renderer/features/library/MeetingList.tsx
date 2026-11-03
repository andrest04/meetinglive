import type { MeetingListItemDto } from '@vozella/contracts';
import { Ellipsis, FileText, FolderInput, Trash } from 'lucide-react';
import { ContextMenu, IconButton, Menu, type MenuEntry } from '../../ui';
import { formatMeetingDate } from './format';

export interface MeetingListLabels {
  readonly list: string;
  readonly noContent: string;
  readonly more: string;
  readonly openSummary: string;
  readonly move: string;
  readonly remove: string;
}

export interface MeetingListProps {
  readonly meetings: readonly MeetingListItemDto[];
  readonly locale: string;
  readonly labels: MeetingListLabels;
  readonly onOpen: (id: string) => void;
  readonly onOpenSummary: (id: string) => void;
  readonly onMove: (meeting: MeetingListItemDto) => void;
  readonly onDelete: (meeting: MeetingListItemDto) => void;
}

/** Newest first, one row per meeting: title and date, then a one line snippet. */
export function MeetingList({
  meetings,
  locale,
  labels,
  onOpen,
  onOpenSummary,
  onMove,
  onDelete,
}: MeetingListProps) {
  return (
    <ul aria-label={labels.list} className="flex flex-col">
      {meetings.map((meeting) => {
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
        return (
          <li key={meeting.id} className="border-b border-hairline last:border-b-0">
            <ContextMenu
              entries={entries}
              className="group flex items-center gap-1 rounded-control transition-colors duration-150 ease-out-quick hover:bg-hover focus-within:bg-hover"
            >
              <button
                type="button"
                onClick={() => {
                  onOpen(meeting.id);
                }}
                className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-control px-2 py-2.5 text-start outline-offset-[-2px] active:bg-pressed"
              >
                <span className="flex items-baseline justify-between gap-4">
                  <span className="truncate text-read font-medium text-ink">{meeting.title}</span>
                  <span className="shrink-0 text-caption tabular-nums text-ink-faint">
                    {formatMeetingDate(meeting.recordedAt, locale)}
                  </span>
                </span>
                <span className="truncate text-ui-lg text-ink-muted">
                  {meeting.snippet === '' ? labels.noContent : meeting.snippet}
                </span>
              </button>
              <Menu
                align="end"
                entries={entries}
                trigger={
                  <IconButton
                    label={labels.more}
                    icon={Ellipsis}
                    className="shrink-0 opacity-0 transition-opacity duration-150 ease-out-quick group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 forced-colors:opacity-100"
                  />
                }
              />
            </ContextMenu>
          </li>
        );
      })}
    </ul>
  );
}
