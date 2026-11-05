import { ALL_VIEW, buildFolderTree, folderView, INBOX_VIEW, type LibraryView } from '@vozella/core';
import { FolderPlus, Palette, Pencil, Trash } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { Translate } from '../../i18n/translate';
import { Icon, Tree, cn, type MenuEntry } from '../../ui';
import { ALL_NODE_ID, INBOX_NODE_ID, buildTreeNodes } from './folder-visuals';
import {
  directCounts,
  MEETINGS_DRAG_TYPE,
  requestDrop,
  requestFolderAction,
  selectView,
  setExpandedIds,
  useLibraryStore,
  type FolderRequest,
} from './library-store';

/** Where the sidebar is showing from: it only highlights the view on the screens that show it. */
export type SidebarLocation = 'library' | 'session' | 'elsewhere';

/** The rename, personality and delete entries, in the sidebar and in the folder header. */
export function folderMenuEntries(
  t: Translate,
  folderId: string,
  run: (request: FolderRequest) => void,
): MenuEntry[] {
  return [
    {
      id: 'rename',
      label: t('LibraryContext_Rename'),
      icon: Pencil,
      onSelect: () => {
        run({ kind: 'rename', folderId });
      },
    },
    {
      id: 'personality',
      label: t('LibraryContext_Personality'),
      icon: Palette,
      onSelect: () => {
        run({ kind: 'personality', folderId });
      },
    },
    {
      id: 'delete',
      label: t('LibraryContext_Delete'),
      icon: Trash,
      onSelect: () => {
        run({ kind: 'delete', folderId });
      },
    },
  ];
}

const nodeIdOf = (view: LibraryView): string =>
  view.kind === 'folder' ? view.id : view.kind === 'all' ? ALL_NODE_ID : INBOX_NODE_ID;

const viewOf = (nodeId: string): LibraryView =>
  nodeId === ALL_NODE_ID ? ALL_VIEW : nodeId === INBOX_NODE_ID ? INBOX_VIEW : folderView(nodeId);

/** Holding a drag over a closed folder opens it. */
export const DRAG_EXPAND_MS = 600;

const carriesMeetings = (event: DragEvent): boolean =>
  [...event.dataTransfer.types].includes(MEETINGS_DRAG_TYPE);

/** All, Inbox and the folder tree with their own meeting counts, plus the way to add a folder. */
export function LibraryFolders({ location }: { readonly location: SidebarLocation }) {
  const { t, locale } = useI18n();
  const folders = useLibraryStore((state) => state.folders);
  const meetings = useLibraryStore((state) => state.meetings);
  const view = useLibraryStore((state) => state.view);
  const expandedIds = useLibraryStore((state) => state.expandedIds);

  const nodes = useMemo(
    () => buildTreeNodes(buildFolderTree(folders, locale), t('Library_Inbox'), t('Ui_LibraryAll')),
    [folders, locale, t],
  );
  const counts = useMemo(() => directCounts(folders, meetings), [folders, meetings]);
  const countOf = (id: string): number =>
    id === ALL_NODE_ID
      ? counts.all
      : id === INBOX_NODE_ID
        ? counts.inbox
        : (counts.byFolder.get(id) ?? 0);

  const showLibrary = (): void => {
    if (location === 'library') return;
    void window.vozella.invoke('workspace.dispatch', {
      action: { type: 'navigateTo', tag: 'History' },
    });
  };
  const runInLibrary = (request: FolderRequest): void => {
    requestFolderAction(request);
    showLibrary();
  };

  const [dropId, setDropId] = useState<string | null>(null);
  const expandTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const disarmExpand = (): void => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  useEffect(() => disarmExpand, []);
  const armExpand = (id: string): void => {
    if (expandTimer.current?.id === id) return;
    disarmExpand();
    expandTimer.current = {
      id,
      timer: setTimeout(() => {
        expandTimer.current = null;
        setExpandedIds(new Set([...useLibraryStore.getState().expandedIds, id]));
      }, DRAG_EXPAND_MS),
    };
  };
  // All shows every meeting, so nothing can be moved into it.
  const dropProps = (id: string) =>
    id === ALL_NODE_ID
      ? undefined
      : {
          onDragOver: (event: DragEvent) => {
            if (!carriesMeetings(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            setDropId(id);
            armExpand(id);
          },
          onDragLeave: (event: DragEvent) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDropId(null);
            disarmExpand();
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            setDropId(null);
            disarmExpand();
            const meetingIds = useLibraryStore.getState().draggedIds;
            if (meetingIds.length === 0) return;
            requestDrop({ meetingIds, folderId: id === INBOX_NODE_ID ? null : id });
          },
          'data-drop-target': dropId === id ? 'true' : undefined,
        };

  return (
    <div className="mt-1 mb-1 flex min-h-0 flex-1 flex-col">
      <Tree
        className="min-h-0 flex-1 overflow-y-auto"
        label={t('Ui_LibraryFolders')}
        nodes={nodes}
        selectedId={location === 'elsewhere' ? null : nodeIdOf(view)}
        expandedIds={expandedIds}
        onExpandedChange={setExpandedIds}
        // Right click away from the Library must not move the person there.
        selectOnContextMenu={location === 'library'}
        onSelect={(id) => {
          selectView(viewOf(id));
          showLibrary();
        }}
        nodeMenu={(id) =>
          id === ALL_NODE_ID || id === INBOX_NODE_ID
            ? undefined
            : folderMenuEntries(t, id, runInLibrary)
        }
        rowProps={(id) => ({
          ...dropProps(id),
          className: cn(
            id === INBOX_NODE_ID && 'mb-3',
            'data-drop-target:bg-pressed data-drop-target:text-ink data-drop-target:outline data-drop-target:outline-border-control forced-colors:data-drop-target:outline-[Highlight]',
          ),
        })}
        trailing={(id) => {
          const count = countOf(id);
          return count === 0 ? null : (
            <span className="tabular ms-auto ps-2 font-mono text-caption text-ink-faint forced-colors:text-[CanvasText]">
              {count}
            </span>
          );
        }}
      />
      <button
        type="button"
        onClick={() => {
          runInLibrary({ kind: 'new' });
        }}
        className="mt-1 flex h-7 shrink-0 items-center gap-1.5 rounded-control px-1.5 text-ui text-ink-muted transition-colors duration-150 ease-out-quick hover:bg-hover hover:text-ink"
      >
        <span aria-hidden="true" className="flex size-4 items-center justify-center">
          <Icon icon={FolderPlus} size={14} />
        </span>
        {t('Library_NewFolderLabel.Text')}
      </button>
    </div>
  );
}
