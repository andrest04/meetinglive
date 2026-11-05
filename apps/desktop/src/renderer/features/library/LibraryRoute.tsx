import { resolveAccentKey, resolveIconKey } from '@vozella/core';
import type { MeetingListItemDto } from '@vozella/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Button, EmptyState, Notice, Skeleton, cn } from '../../ui';
import { Breadcrumbs } from './Breadcrumbs';
import { ConfirmDialog, MoveDialog, NameDialog, PersonalityDialog } from './dialogs';
import {
  clearFolderRequest,
  rememberScroll,
  setCursor,
  useLibraryStore,
  type FolderRequest,
} from './library-store';
import { folderIdOfView } from './library-store';
import { folderMenuEntries } from './LibraryFolders';
import { ListHeader } from './ListHeader';
import { MeetingGrid } from './MeetingGrid';
import { MeetingPreview } from './MeetingPreview';
import { describeSkipped } from './format';
import { nextCursor } from './logbook';
import { useMeetingPreview } from './use-meeting-preview';
import { useLibrary, type StatusMessage } from './use-library';

type DialogState =
  | { readonly kind: 'newFolder' }
  | { readonly kind: 'rename'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'personality'; readonly folderId: string }
  | { readonly kind: 'deleteFolder'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'move'; readonly meeting: MeetingListItemDto }
  | { readonly kind: 'deleteMeeting'; readonly meeting: MeetingListItemDto }
  | { readonly kind: 'deleteMeetingPermanently'; readonly meeting: MeetingListItemDto };

/** From this width of the content the preview sits beside the list; below it a click opens. */
export const PANED_LAYOUT_PX = 760;

function useWideLayout(): { ref: React.RefObject<HTMLElement | null>; wide: boolean } {
  const ref = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (): void => {
      setWide(element.clientWidth >= PANED_LAYOUT_PX);
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

/** The Library route: the list pane with its header, the preview pane and the dialogs. */
export function LibraryRoute() {
  const { t, locale } = useI18n();
  const library = useLibrary(locale, t('Library_Inbox'));
  const { ref: layoutRef, wide } = useWideLayout();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [skippedDismissed, setSkippedDismissed] = useState(false);

  useEffect(() => {
    void window.vozella.invoke('library.getLocation', {}).then((location) => {
      setStartupError(location.startupError);
    });
  }, []);

  const text = (message: StatusMessage): string => t(message.key, ...message.args);
  const folderName = (id: string): string => library.folders.find((f) => f.id === id)?.name ?? '';

  const crumbs = library.breadcrumbs.map((crumb) => ({
    id: crumb.folderId,
    label: crumb.folderId === null ? t('Library_Inbox') : folderName(crumb.folderId),
  }));

  const runFolderAction = (request: FolderRequest): void => {
    if (request.kind === 'new') setDialog({ kind: 'newFolder' });
    else if (request.kind === 'rename') {
      setDialog({ kind: 'rename', folderId: request.folderId, name: folderName(request.folderId) });
    } else if (request.kind === 'personality') {
      setDialog({ kind: 'personality', folderId: request.folderId });
    } else if (library.canDeleteFolder(request.folderId)) {
      setDialog({
        kind: 'deleteFolder',
        folderId: request.folderId,
        name: folderName(request.folderId),
      });
    } else {
      library.showStatus({ key: 'LibraryDeleteFolder_NotEmpty', args: [] });
    }
  };

  // The sidebar cannot open dialogs: it leaves the request here, also from another screen.
  const folderRequest = useLibraryStore((state) => state.folderRequest);
  const runRequest = useRef(runFolderAction);
  runRequest.current = runFolderAction;
  useEffect(() => {
    if (!folderRequest) return;
    clearFolderRequest();
    runRequest.current(folderRequest);
  }, [folderRequest]);

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

  const cursorId = useLibraryStore((state) => state.cursorId);
  const listedIds = useMemo(() => library.meetings.map((m) => m.id), [library.meetings]);
  const lastListed = useRef<readonly string[]>([]);
  // The preview needs a row: the newest at first, the neighbor when the row went away.
  useEffect(() => {
    const previous = lastListed.current;
    lastListed.current = listedIds;
    if (!wide || library.isLoading) return;
    const next = nextCursor(useLibraryStore.getState().cursorId, previous, listedIds);
    if (next !== useLibraryStore.getState().cursorId) setCursor(next);
  }, [listedIds, wide, library.isLoading, cursorId]);
  const previewId = wide && cursorId !== null && listedIds.includes(cursorId) ? cursorId : null;
  const preview = useMeetingPreview(previewId);

  const gridLabels = useMemo(
    () => ({
      grid: t('HistoryPage_Title.Text'),
      noContent: t('History_NoContent'),
      more: t('HistoryRow_More.AutomationProperties.Name'),
      openSummary: t('HistoryRow_OpenSummary'),
      move: t('HistoryRow_Move'),
      remove: t('HistoryRow_Delete'),
      today: t('Ui_LibraryToday'),
      yesterday: t('Ui_LibraryYesterday'),
      noDate: t('Ui_LibraryNoDate'),
      duration: (minutes: number) => t('Ui_LibraryDurationMinutes', String(minutes)),
    }),
    [t],
  );

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
    <section ref={layoutRef} className="flex min-h-0 flex-1">
      <div
        data-testid="library-list-pane"
        className={cn(
          'flex min-h-0 min-w-0 flex-col',
          wide ? 'w-[clamp(340px,38%,440px)] shrink-0 border-e border-hairline' : 'flex-1',
        )}
      >
        <ListHeader
          title={
            library.selectedFolder
              ? library.selectedFolder.name
              : library.view.kind === 'all'
                ? t('Ui_LibraryAll')
                : t('Library_Inbox')
          }
          count={library.viewCount}
          folder={library.selectedFolder}
          breadcrumbs={
            <Breadcrumbs
              crumbs={crumbs}
              label={t('Chat_ScopeFolder')}
              onSelect={library.selectFolder}
            />
          }
          menuEntries={
            library.selectedFolder
              ? folderMenuEntries(t, library.selectedFolder.id, runFolderAction)
              : []
          }
          menuLabel={t('Ui_LibraryFolderActions')}
          note={library.noteText}
          noteLabel={t('Library_FolderNote.Header')}
          notePlaceholder={t('Library_FolderNote.PlaceholderText')}
          onNoteChange={library.setNoteText}
          onNoteBlur={() => {
            void library.saveNote();
          }}
          query={library.query}
          searchLabel={t('Library_Search.PlaceholderText')}
          onQueryChange={library.setQuery}
        />

        <div className="flex shrink-0 flex-col gap-2 px-4 empty:hidden">
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

        <div className="flex min-h-0 flex-1 flex-col">
          {library.isLoading ? (
            <div role="status" aria-label={t('Ui_Loading')} className="flex flex-col">
              {[0, 1, 2, 3, 4].map((row) => (
                <div
                  key={row}
                  className="flex h-16 items-center gap-4 border-b border-hairline ps-4 pe-4"
                >
                  <Skeleton className="h-3.5 w-12 shrink-0" />
                  <Skeleton className="h-3.5 w-full" />
                </div>
              ))}
            </div>
          ) : library.flags.hasMeetings ? (
            <MeetingGrid
              key={`${library.view.kind}-${String(folderIdOfView(library.view))}`}
              meetings={library.meetings}
              locale={locale}
              labels={gridLabels}
              cursorId={cursorId}
              clickOpens={!wide}
              initialScrollOffset={useLibraryStore.getState().scrollOffset}
              onCursorChange={setCursor}
              onScrollOffsetChange={rememberScroll}
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
            <div className="px-4">
              <EmptyState
                message={t(emptyMessage)}
                action={
                  flags.showLibraryEmpty ? (
                    <Button onClick={library.goRecord}>{t('HistoryPage_EmptyCta.Content')}</Button>
                  ) : undefined
                }
              />
            </div>
          ) : null}
        </div>
      </div>
      {wide ? (
        <section
          data-testid="library-preview"
          aria-label={t('Ui_LibraryPreview')}
          className="flex min-w-0 flex-1 flex-col"
        >
          <MeetingPreview state={preview} preferredTab={null} onOpen={library.openMeeting} />
        </section>
      ) : null}

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
          'Ui_LibraryDeleteContent',
          shown?.kind === 'deleteMeeting' ? shown.meeting.title : '',
        )}
        cancelLabel={t('HistoryDelete_Cancel')}
        primaryLabel={t('HistoryDelete_Primary')}
        onConfirm={() => {
          if (dialog?.kind !== 'deleteMeeting') return;
          const { meeting } = dialog;
          void library.deleteMeeting(meeting.id).then((outcome) => {
            if (outcome === 'trash-failed')
              setDialog({ kind: 'deleteMeetingPermanently', meeting });
          });
        }}
      />
      <ConfirmDialog
        {...dialogChrome}
        open={dialog?.kind === 'deleteMeetingPermanently'}
        title={t('Ui_LibraryDeletePermanentTitle')}
        description={t(
          'Ui_LibraryDeletePermanentContent',
          shown?.kind === 'deleteMeetingPermanently' ? shown.meeting.title : '',
        )}
        cancelLabel={t('HistoryDelete_Cancel')}
        primaryLabel={t('Ui_LibraryDeletePermanentPrimary')}
        onConfirm={() => {
          if (dialog?.kind === 'deleteMeetingPermanently') {
            void library.deleteMeeting(dialog.meeting.id, 'permanent');
          }
        }}
      />
    </section>
  );
}
