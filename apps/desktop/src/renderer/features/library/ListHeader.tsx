import type { FolderDto } from '@vozella/contracts';
import { Ellipsis, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon, IconButton, Input, Menu, Textarea, type MenuEntry } from '../../ui';
import { folderAccent, folderIcon } from './folder-visuals';

export interface ListHeaderProps {
  /** The name of the view: All, Inbox or the folder. */
  readonly title: string;
  readonly count: number;
  /** Only a real folder has an icon, a path, a menu and a note. */
  readonly folder: FolderDto | null;
  readonly breadcrumbs: ReactNode;
  readonly menuEntries: readonly MenuEntry[];
  readonly menuLabel: string;
  readonly note: string;
  readonly noteLabel: string;
  readonly notePlaceholder: string;
  readonly onNoteChange: (value: string) => void;
  readonly onNoteBlur: () => void;
  readonly query: string;
  readonly searchLabel: string;
  readonly onQueryChange: (value: string) => void;
}

/** The head of the list pane. There is no page title: the view's own name says where you are. */
export function ListHeader({
  title,
  count,
  folder,
  breadcrumbs,
  menuEntries,
  menuLabel,
  note,
  noteLabel,
  notePlaceholder,
  onNoteChange,
  onNoteBlur,
  query,
  searchLabel,
  onQueryChange,
}: ListHeaderProps) {
  return (
    <header className="flex shrink-0 flex-col gap-1.5 px-4 pb-3">
      {folder ? breadcrumbs : null}
      <div className="flex min-h-8 min-w-0 items-center gap-2">
        {folder ? (
          <Icon icon={folderIcon(folder)} size={16} style={{ color: folderAccent(folder) }} />
        ) : null}
        <h1 className="truncate text-heading font-semibold tracking-[-0.01em]">{title}</h1>
        <span
          data-testid="library-view-count"
          className="tabular shrink-0 pt-1 font-mono text-caption text-ink-faint"
        >
          {count}
        </span>
        {folder ? (
          <span className="ms-auto shrink-0">
            <Menu
              align="end"
              entries={menuEntries}
              trigger={<IconButton label={menuLabel} icon={Ellipsis} size="sm" />}
            />
          </span>
        ) : null}
      </div>
      {folder ? (
        <Textarea
          rows={1}
          aria-label={noteLabel}
          value={note}
          placeholder={notePlaceholder}
          onChange={(event) => {
            onNoteChange(event.target.value);
          }}
          onBlur={onNoteBlur}
          className="field-sizing-content max-h-30 min-h-0! w-full resize-none! border-transparent bg-transparent px-0! hover:not-data-disabled:not-disabled:bg-transparent focus:border-border-control focus:px-2.5!"
        />
      ) : null}
      <div className="relative mt-1.5">
        <Icon
          icon={Search}
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
        />
        <Input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
          }}
          className="w-full pl-8 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>
    </header>
  );
}
