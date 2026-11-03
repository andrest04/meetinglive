import { resolveAccentKey, resolveIconKey } from '@vozella/core';
import type { MeetingListItemDto } from '@vozella/contracts';
import { FolderPlus, Ellipsis, PanelLeft, Palette, Pencil, Search, Trash } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Notice,
  SectionHeader,
  Skeleton,
  Textarea,
  Tree,
  Icon,
  Menu,
  Field,
  cn,
  type MenuEntry,
} from '../../ui';
import { Breadcrumbs } from './Breadcrumbs';
import { ConfirmDialog, MoveDialog, NameDialog, PersonalityDialog } from './dialogs';
import { INBOX_NODE_ID, buildTreeNodes } from './folder-visuals';
import { MeetingList } from './MeetingList';
import { describeSkipped } from './format';
import { useLibrary, type StatusMessage } from './use-library';

/** At or above this width of the page area the folder pane stays open beside the list. */
const WIDE_LAYOUT_PX = 600;

type DialogState =
  | { readonly kind: 'newFolder' }
  | { readonly kind: 'rename'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'personality'; readonly folderId: string }
  | { readonly kind: 'deleteFolder'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'move'; readonly meeting: MeetingListItemDto }
  | { readonly kind: 'deleteMeeting'; readonly meeting: MeetingListItemDto };

function useWideLayout(): { ref: React.RefObject<HTMLDivElement | null>; wide: boolean } {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => {
      setWide(element.clientWidth >= WIDE_LAYOUT_PX);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return { ref, wide };
}

/** The Library page: folder tree, breadcrumbs, search, the meeting list and the folder dialogs. */
export function LibraryRoute() {
  const { t, locale } = useI18n();
  const library = useLibrary(locale, t('Library_Inbox'));
  const { ref: layoutRef, wide } = useWideLayout();
  const [paneOpen, setPaneOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [skippedDismissed, setSkippedDismissed] = useState(false);

  useEffect(() => {
    void window.vozella.invoke('library.getLocation', {}).then((location) => {
      setStartupError(location.startupError);
    });
  }, []);

  const text = (message: StatusMessage): string => t(message.key, ...message.args);
  const nodes = useMemo(() => buildTreeNodes(library.tree, t('Library_Inbox')), [library.tree, t]);
  const treeSelected = library.selectedId ?? INBOX_NODE_ID;
  const folderName = (id: string): string => library.folders.find((f) => f.id === id)?.name ?? '';

  const crumbs = library.breadcrumbs.map((crumb) => ({
    id: crumb.folderId,
    label: crumb.folderId === null ? t('Library_Inbox') : folderName(crumb.folderId),
  }));

  const folderEntries = (folderId: string): MenuEntry[] => [
    {
      id: 'rename',
      label: t('LibraryContext_Rename'),
      icon: Pencil,
      onSelect: () => {
        setDialog({ kind: 'rename', folderId, name: folderName(folderId) });
      },
    },
    {
      id: 'personality',
      label: t('LibraryContext_Personality'),
      icon: Palette,
      onSelect: () => {
        setDialog({ kind: 'personality', folderId });
      },
    },
    {
      id: 'delete',
      label: t('LibraryContext_Delete'),
      icon: Trash,
      onSelect: () => {
        if (library.canDeleteFolder(folderId)) {
          setDialog({ kind: 'deleteFolder', folderId, name: folderName(folderId) });
        } else {
          library.showStatus({ key: 'LibraryDeleteFolder_NotEmpty', args: [] });
        }
      },
    },
  ];

  const select = (id: string | null): void => {
    library.selectFolder(id);
    setPaneOpen(false);
  };

  const tree = (
    <Tree
      label={t('Ui_LibraryFolders')}
      nodes={nodes}
      selectedId={treeSelected}
      expandedIds={library.expandedIds}
      onExpandedChange={library.setExpandedIds}
      onSelect={(id) => {
        select(id === INBOX_NODE_ID ? null : id);
      }}
      nodeMenu={(id) => (id === INBOX_NODE_ID ? undefined : folderEntries(id))}
    />
  );

  const closeDialog = (): void => {
    setDialog(null);
  };
  const dialogChrome = {
    cancelLabel: '',
    closeLabel: t('Ui_Close'),
    onOpenChange: (open: boolean): void => {
      if (!open) closeDialog();
    },
  };

  // Keep the last dialog's data while it fades out, so its text does not blank first.
  const lastDialog = useRef(dialog);
  if (dialog) lastDialog.current = dialog;
  const shown = dialog ?? lastDialog.current;
  const personalityFolder =
    shown?.kind === 'personality'
      ? (library.folders.find((f) => f.id === shown.folderId) ?? null)
      : null;
  const newFolderTitle =
    library.selectedFolder === null
      ? t('LibraryNewFolder_Title')
      : t('LibraryNewFolder_TitleIn', library.selectedFolder.name);

  const { flags } = library;
  const emptyMessage: StringKey | null = flags.showLibraryEmpty
    ? 'HistoryPage_Empty.Text'
    : flags.showInboxEmpty
      ? 'Library_InboxEmpty.Text'
      : flags.showFolderEmpty
        ? 'Library_FolderEmpty.Text'
        : flags.showNoMatches
          ? 'Ui_LibrarySearchEmpty'
          : null;

  return (
    <section ref={layoutRef} className="relative flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <SectionHeader level={1} quiet title={t('HistoryPage_Title.Text')} />
        <div className="flex shrink-0 items-center gap-2">
          {wide ? null : (
            <IconButton
              label={t('Chat_ScopeFolder')}
              icon={PanelLeft}
              variant="secondary"
              aria-expanded={paneOpen}
              onClick={() => {
                setPaneOpen((open) => !open);
              }}
            />
          )}
          <Button
            icon={FolderPlus}
            onClick={() => {
              setDialog({ kind: 'newFolder' });
            }}
          >
            {t('Library_NewFolderLabel.Text')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {startupError ? (
          <Notice tone="warning">{t('Ui_LibraryMigrationFailed', startupError)}</Notice>
        ) : null}
        {library.problem ? (
          <Notice tone="warning">
            {library.problem.reason === 'corrupt'
              ? t('Ui_LibraryFoldersDamaged', library.problem.message ?? '')
              : t('Ui_LibraryFolderFailed', library.problem.message ?? library.problem.reason)}
          </Notice>
        ) : null}
        {library.skipped.length > 0 && !skippedDismissed ? (
          <Notice
            onDismiss={() => {
              setSkippedDismissed(true);
            }}
            dismissLabel={t('Ui_Close')}
          >
            {t('Ui_LibrarySkippedFiles', describeSkipped(library.skipped))}
          </Notice>
        ) : null}
        {library.status ? (
          <Notice tone="warning" onDismiss={library.dismissStatus} dismissLabel={t('Ui_Close')}>
            {text(library.status)}
          </Notice>
        ) : null}
      </div>

      <div className={cn('relative grid gap-x-8', wide && 'grid-cols-[12.5rem_minmax(0,1fr)]')}>
        {wide ? <aside className="min-w-0">{tree}</aside> : null}
        {!wide && paneOpen ? (
          <aside
            onKeyDown={(event) => {
              if (event.key === 'Escape') setPaneOpen(false);
            }}
            className="absolute start-0 top-12 z-20 max-h-[60vh] w-60 overflow-y-auto rounded-overlay border border-hairline bg-paper-raised p-1.5 shadow-overlay"
          >
            {tree}
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-1">
              <Breadcrumbs crumbs={crumbs} label={t('Chat_ScopeFolder')} onSelect={select} />
              {library.selectedFolder ? (
                <Menu
                  align="start"
                  entries={folderEntries(library.selectedFolder.id)}
                  trigger={
                    <IconButton label={t('Ui_LibraryFolderActions')} icon={Ellipsis} size="sm" />
                  }
                />
              ) : null}
            </div>
            <div className="relative min-w-40 flex-1 sm:max-w-60">
              <Icon
                icon={Search}
                size={14}
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-faint"
              />
              <Input
                type="search"
                aria-label={t('Library_Search.PlaceholderText')}
                placeholder={t('Library_Search.PlaceholderText')}
                value={library.query}
                onChange={(event) => {
                  library.setQuery(event.target.value);
                }}
                className="w-full pl-8 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
              />
            </div>
          </div>

          {library.selectedFolder ? (
            <Field label={t('Library_FolderNote.Header')}>
              <Textarea
                rows={1}
                value={library.noteText}
                placeholder={t('Library_FolderNote.PlaceholderText')}
                onChange={(event) => {
                  library.setNoteText(event.target.value);
                }}
                onBlur={() => {
                  void library.saveNote();
                }}
                className="field-sizing-content max-h-30 min-h-0! w-full resize-none! border-transparent bg-transparent px-0 hover:not-data-disabled:not-disabled:bg-transparent focus:border-border-control focus:px-2.5"
              />
            </Field>
          ) : null}

          {library.isLoading ? (
            <div role="status" aria-label={t('Ui_Loading')} className="flex flex-col gap-4 py-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-4/5" />
            </div>
          ) : library.flags.hasMeetings ? (
            <MeetingList
              meetings={library.meetings}
              locale={locale}
              labels={{
                list: t('HistoryPage_Title.Text'),
                noContent: t('History_NoContent'),
                more: t('HistoryRow_More.AutomationProperties.Name'),
                openSummary: t('HistoryRow_OpenSummary'),
                move: t('HistoryRow_Move'),
                remove: t('HistoryRow_Delete'),
              }}
              onOpen={(id) => {
                library.openMeeting(id, 'Transcript');
              }}
              onOpenSummary={(id) => {
                library.openMeeting(id, 'Summary');
              }}
              onMove={(meeting) => {
                setDialog({ kind: 'move', meeting });
              }}
              onDelete={(meeting) => {
                void library.beginDelete(meeting.id).then((allowed) => {
                  if (allowed) setDialog({ kind: 'deleteMeeting', meeting });
                });
              }}
            />
          ) : emptyMessage ? (
            <EmptyState
              message={t(emptyMessage)}
              action={
                flags.showLibraryEmpty ? (
                  <Button onClick={library.goRecord}>{t('HistoryPage_EmptyCta.Content')}</Button>
                ) : undefined
              }
            />
          ) : null}
        </div>
      </div>

      <NameDialog
        {...dialogChrome}
        open={dialog?.kind === 'newFolder'}
        title={newFolderTitle}
        cancelLabel={t('LibraryNewFolder_Cancel')}
        primaryLabel={t('LibraryNewFolder_Primary')}
        fieldLabel={t('LibraryFolderName.Header')}
        placeholder={t('LibraryFolderName.PlaceholderText')}
        initialValue=""
        onSubmit={async (name) => {
          const result = await library.createFolder(name);
          return !result.ok && result.reason === 'name-taken' ? t('Ui_LibraryNameTaken') : null;
        }}
      />
      <NameDialog
        {...dialogChrome}
        open={dialog?.kind === 'rename'}
        title={t('LibraryRenameFolder_Title')}
        cancelLabel={t('LibraryRenameFolder_Cancel')}
        primaryLabel={t('LibraryRenameFolder_Primary')}
        fieldLabel={t('LibraryFolderName.Header')}
        placeholder={t('LibraryFolderName.PlaceholderText')}
        initialValue={shown?.kind === 'rename' ? shown.name : ''}
        onSubmit={async (name) => {
          if (dialog?.kind !== 'rename') return null;
          const result = await library.renameFolder(dialog.folderId, name);
          return !result.ok && result.reason === 'name-taken' ? t('Ui_LibraryNameTaken') : null;
        }}
      />
      <PersonalityDialog
        {...dialogChrome}
        open={dialog?.kind === 'personality'}
        title={t('LibraryPersonality_Title')}
        cancelLabel={t('LibraryPersonality_Cancel')}
        primaryLabel={t('LibraryPersonality_Primary')}
        folderName={personalityFolder?.name ?? ''}
        colorHeader={t('LibraryPersonality_ColorHeader.Text')}
        iconHeader={t('LibraryPersonality_IconHeader.Text')}
        initialColor={resolveAccentKey(personalityFolder?.colorKey, personalityFolder?.id ?? '')}
        initialIcon={resolveIconKey(personalityFolder?.iconKey)}
        onSave={(colorKey, iconKey) => {
          if (dialog?.kind === 'personality') {
            void library.updatePersonality(dialog.folderId, colorKey, iconKey);
          }
        }}
      />
      <ConfirmDialog
        {...dialogChrome}
        open={dialog?.kind === 'deleteFolder'}
        title={t('LibraryDeleteFolder_Title')}
        description={t(
          'LibraryDeleteFolder_Content',
          shown?.kind === 'deleteFolder' ? shown.name : '',
        )}
        cancelLabel={t('LibraryDeleteFolder_Cancel')}
        primaryLabel={t('LibraryDeleteFolder_Primary')}
        onConfirm={() => {
          if (dialog?.kind === 'deleteFolder') void library.deleteFolder(dialog.folderId);
        }}
      />
      <MoveDialog
        {...dialogChrome}
        open={dialog?.kind === 'move'}
        title={t('LibraryMove_Title')}
        cancelLabel={t('LibraryMove_Cancel')}
        primaryLabel={t('LibraryMove_Primary')}
        destinations={library.destinations}
        currentFolderId={shown?.kind === 'move' ? shown.meeting.folderId : null}
        onMove={(folderId) => {
          if (dialog?.kind === 'move') void library.moveMeeting(dialog.meeting.id, folderId);
        }}
      />
      <ConfirmDialog
        {...dialogChrome}
        open={dialog?.kind === 'deleteMeeting'}
        title={t('HistoryDelete_Title')}
        description={t(
          'HistoryDelete_Content',
          shown?.kind === 'deleteMeeting' ? shown.meeting.title : '',
        )}
        cancelLabel={t('HistoryDelete_Cancel')}
        primaryLabel={t('HistoryDelete_Primary')}
        onConfirm={() => {
          if (dialog?.kind === 'deleteMeeting') void library.deleteMeeting(dialog.meeting.id);
        }}
      />
    </section>
  );
}
