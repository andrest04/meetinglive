import { FolderInput, Trash, X } from 'lucide-react';
import { Button, IconButton } from '../../ui';

export interface BulkBarProps {
  readonly label: string;
  /** "Checked: 3", or the work under way. */
  readonly status: string;
  readonly busy: boolean;
  readonly moveLabel: string;
  readonly deleteLabel: string;
  readonly clearLabel: string;
  readonly onMove: () => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
}

/** What can be done to the checked meetings. It holds its actions while one is running. */
export function BulkBar({
  label,
  status,
  busy,
  moveLabel,
  deleteLabel,
  clearLabel,
  onMove,
  onDelete,
  onClear,
}: BulkBarProps) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-busy={busy}
      className="flex h-10 shrink-0 items-center gap-1 border-y border-hairline ps-4 pe-1.5"
    >
      <span role="status" className="tabular min-w-0 flex-1 truncate text-ui text-ink">
        {status}
      </span>
      <Button size="sm" variant="quiet" icon={FolderInput} disabled={busy} onClick={onMove}>
        {moveLabel}
      </Button>
      <Button size="sm" variant="quiet" icon={Trash} disabled={busy} onClick={onDelete}>
        {deleteLabel}
      </Button>
      <IconButton label={clearLabel} icon={X} size="sm" disabled={busy} onClick={onClear} />
    </div>
  );
}
