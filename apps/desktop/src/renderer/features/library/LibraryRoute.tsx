import { resolveAccentKey, resolveIconKey } from '@vozella/core';
import type { MeetingListItemDto } from '@vozella/contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import type { StringKey } from '../../i18n/translate';
import { Button, EmptyState, Notice, Skeleton, cn } from '../../ui';
import { Breadcrumbs } from './Breadcrumbs';
import { BulkBar } from './BulkBar';
import { matchLibraryShortcut } from '../../app/shortcuts';
import { RenameDialog } from '../session/RenameDialog';
import { ConfirmDialog, MoveDialog, NameDialog, PersonalityDialog } from './dialogs';
import {
  clearFolderRequest,
  refreshLibrary,
  rememberScroll,
  setCursor,
  useLibraryStore,
  type FolderRequest,
} from './library-store';
import { folderIdOfView } from './library-store';
import { folderMenuEntries } from './LibraryFolders';
import {
  EMPTY_CHECKS,
  checkAll,
  extendChecks,
  keepLive,
  setGroup,
  toggleCheck,
  type Checks,
} from './library-selection';
import { ListHeader } from './ListHeader';
import { MeetingGrid, type MeetingGridHandle } from './MeetingGrid';
import { MeetingPreview } from './MeetingPreview';
import { describeSkipped } from './format';
import { nextCursor } from './logbook';
import { tabOfHit } from './search-results';
import { useMeetingPreview } from './use-meeting-preview';
import { useLibrary, type StatusMessage } from './use-library';

type DialogState =
  | { readonly kind: 'newFolder' }
  | { readonly kind: 'rename'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'personality'; readonly folderId: string }
  | { readonly kind: 'deleteFolder'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'move'; readonly meeting: MeetingListItemDto }
  | { readonly kind: 'deleteMeeting'; readonly meeting: MeetingListItemDto }
  /** `refused`: the Recycle Bin said no. Otherwise it was asked for directly, with Shift+Delete. */
  | {
      readonly kind: 'deleteMeetingPermanently';
      readonly meeting: MeetingListItemDto;
      readonly refused: boolean;
    }
  | { readonly kind: 'moveMany'; readonly meetings: readonly MeetingListItemDto[] }
  | { readonly kind: 'deleteMany'; readonly meetingIds: readonly string[] }
  | {
      readonly kind: 'deleteManyPermanently';
      readonly meetingIds: readonly string[];
      readonly refused: boolean;
    }
  | { readonly kind: 'renameMeeting'; readonly meeting: MeetingListItemDto };

type BulkWork = { readonly kind: 'moving' | 'deleting'; readonly count: number } | null;

const FOCUS_RETRY_MS = 250;

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
  // Checks belong to one list: another view or another search starts with none.
  const [checks, setChecks] = useState<Checks>(EMPTY_CHECKS);
  const [bulkWork, setBulkWork] = useState<BulkWork>(null);
  const viewKey = `${library.view.kind}-${String(folderIdOfView(library.view))}`;
  useEffect(() => {
    setChecks(EMPTY_CHECKS);
  }, [viewKey, library.query]);
  useEffect(() => {
    setChecks((current) => keepLive(current, listedIds));
  }, [listedIds]);
  const checkedMeetings = useMemo(
    () => library.meetings.filter((m) => checks.checked.has(m.id)),
    [library.meetings, checks.checked],
  );

  const onExtendChecks = useCallback(
    (fromId: string, toId: string): void => {
      setChecks((current) => extendChecks(current, listedIds, fromId, toId));
    },
    [listedIds],
  );

  /** A row action from a checked row applies to all the checked ones, and alone otherwise. */
  const targetsOf = (meeting: MeetingListItemDto): readonly MeetingListItemDto[] =>
    checks.checked.has(meeting.id) ? checkedMeetings : [meeting];

  const askMove = (targets: readonly MeetingListItemDto[]): void => {
    const [only] = targets;
    if (!only) return;
    if (targets.length === 1) setDialog({ kind: 'move', meeting: only });
    else setDialog({ kind: 'moveMany', meetings: targets });
  };

  const askDelete = (targets: readonly MeetingListItemDto[], permanent: boolean): void => {
    const [only] = targets;
    if (!only) return;
    if (targets.length > 1) {
      const meetingIds = targets.map((m) => m.id);
      setDialog(
        permanent
          ? { kind: 'deleteManyPermanently', meetingIds, refused: false }
          : { kind: 'deleteMany', meetingIds },
      );
      return;
    }
    void library.beginDelete(only.id).then((allowed) => {
      if (!allowed) return;
      setDialog(
        permanent
          ? { kind: 'deleteMeetingPermanently', meeting: only, refused: false }
          : { kind: 'deleteMeeting', meeting: only },
      );
    });
  };

  // After a keyboard delete the row with the focus is gone: the focus goes on to its neighbor.
  const gridRef = useRef<MeetingGridHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fromKeyboard = useRef(false);
  const wantsListFocus = useRef(false);
  const [workDone, setWorkDone] = useState(0);
  const afterWork = (): void => {
    if (fromKeyboard.current) wantsListFocus.current = true;
    setWorkDone((count) => count + 1);
  };
  useEffect(() => {
    if (!wantsListFocus.current || dialog !== null) return;
    if (cursorId === null || !listedIds.includes(cursorId)) return;
    const take = (): void => {
      const active = document.activeElement;
      const lost = !active || active === document.body || active.closest('[role="dialog"]');
      if (lost) gridRef.current?.focusCursor();
    };
    take();
    // A dialog that is still fading gives the focus back when it ends, to a row that may be gone.
    const again = setTimeout(take, FOCUS_RETRY_MS);
    wantsListFocus.current = false;
    fromKeyboard.current = false;
    return () => {
      clearTimeout(again);
    };
  }, [cursorId, listedIds, dialog, workDone]);

  // Ctrl+A on a list the second stage is still filling waits for the whole list.
  const selectAllPending = useRef(false);
  useEffect(() => {
    selectAllPending.current = false;
  }, [viewKey, library.query]);
  useEffect(() => {
    if (!selectAllPending.current || library.searching) return;
    selectAllPending.current = false;
    setChecks(checkAll(listedIds));
  }, [library.searching, listedIds]);
  const onSelectAll = (): void => {
    if (library.searching) selectAllPending.current = true;
    else setChecks(checkAll(listedIds));
  };

  const onRowKey = (
    action: 'toggle' | 'rename' | 'delete' | 'deletePermanently' | 'clear',
    id: string,
  ): void => {
    const meeting = library.meetings.find((m) => m.id === id);
    if (action === 'clear') {
      if (checks.checked.size > 0) setChecks(EMPTY_CHECKS);
      else library.setQuery('');
    } else if (!meeting) {
      return;
    } else if (action === 'toggle') {
      setChecks((current) => toggleCheck(current, id));
    } else if (action === 'rename') {
      fromKeyboard.current = true;
      setRenameProblem(null);
      setDialog({ kind: 'renameMeeting', meeting });
    } else {
      fromKeyboard.current = true;
      askDelete(targetsOf(meeting), action === 'deletePermanently');
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (matchLibraryShortcut(event) !== 'librarySearch') return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const [renameProblem, setRenameProblem] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const renameMeeting = async (id: string, title: string): Promise<void> => {
    setRenameBusy(true);
    try {
      const { status } = await window.vozella.invoke('session.rename', { id, title });
      if (status === 'blocked') {
        setRenameProblem(t('Ui_SessionRenameBlockedText'));
        return;
      }
      // This channel does not announce a change, so the list asks for itself.
      await refreshLibrary();
      setDialog(null);
      afterWork();
    } catch (error) {
      setRenameProblem(
        t('Ui_SessionRenameFailedText', error instanceof Error ? error.message : ''),
      );
    } finally {
      setRenameBusy(false);
    }
  };

  const runMoveMany = async (
    meetings: readonly MeetingListItemDto[],
    folderId: string | null,
  ): Promise<void> => {
    setBulkWork({ kind: 'moving', count: meetings.length });
    const failed = await library.moveMeetings(
      meetings.map((m) => m.id),
      folderId,
    );
    setBulkWork(null);
    setChecks((current) => keepLive(current, failed));
    afterWork();
  };

  const runDeleteMany = async (
    meetingIds: readonly string[],
    mode: 'trash' | 'permanent',
  ): Promise<void> => {
    setBulkWork({ kind: 'deleting', count: meetingIds.length });
    const { failed, refused } = await library.deleteMeetings(meetingIds, mode);
    setBulkWork(null);
    setChecks((current) => keepLive(current, [...failed, ...refused]));
    if (refused.length > 0) {
      setDialog({ kind: 'deleteManyPermanently', meetingIds: refused, refused: true });
    }
    afterWork();
  };

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
      checkMeeting: (title: string) => t('Ui_LibraryCheckMeeting', title),
      checkDay: (day: string) => t('Ui_LibraryCheckDay', day),
    }),
    [t],
  );

  const { flags } = library;
  // Nothing matched is not known yet while the second stage is still reading.
  const emptyMessage: StringKey | null = flags.showLibraryEmpty
    ? 'HistoryPage_Empty.Text'
    : flags.showInboxEmpty
      ? 'Library_InboxEmpty.Text'
      : flags.showFolderEmpty
        ? 'Library_FolderEmpty.Text'
        : flags.showNoMatches && !library.searching
          ? 'Ui_LibrarySearchEmpty'
          : null;
  const searchStatus = library.searching
    ? t('Ui_LibrarySearching')
    : library.searchFailed
      ? t('Ui_LibrarySearchTitlesOnly')
      : t('Ui_LibrarySearchMatches', String(library.meetings.length));

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
          searchRef={searchRef}
          onSearchKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              library.setQuery('');
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              gridRef.current?.focusCursor();
            }
          }}
          clearSearchLabel={t('Ui_LibrarySearchClear')}
          onQueryChange={library.setQuery}
          searchStatus={searchStatus}
          searchAll={
            library.view.kind === 'all'
              ? null
              : { label: t('Ui_LibrarySearchAll'), onSelect: library.searchEverything }
          }
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

        {checks.checked.size > 0 ? (
          <BulkBar
            label={t('Ui_LibraryBulkLabel')}
            status={
              bulkWork === null
                ? t('Ui_LibraryBulkChecked', String(checks.checked.size))
                : t(
                    bulkWork.kind === 'moving' ? 'Ui_LibraryBulkMoving' : 'Ui_LibraryBulkDeleting',
                    String(bulkWork.count),
                  )
            }
            busy={bulkWork !== null}
            moveLabel={t('HistoryRow_Move')}
            deleteLabel={t('HistoryRow_Delete')}
            clearLabel={t('Ui_LibraryBulkClear')}
            onMove={() => {
              askMove(checkedMeetings);
            }}
            onDelete={() => {
              fromKeyboard.current = false;
              askDelete(checkedMeetings, false);
            }}
            onClear={() => {
              setChecks(EMPTY_CHECKS);
            }}
          />
        ) : null}

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
              handle={gridRef}
              key={`${library.view.kind}-${String(folderIdOfView(library.view))}`}
              meetings={library.meetings}
              locale={locale}
              labels={gridLabels}
              query={library.query}
              hits={library.hits}
              cursorId={cursorId}
              clickOpens={!wide}
              initialScrollOffset={useLibraryStore.getState().scrollOffset}
              checked={checks.checked}
              onToggleCheck={(id) => {
                setChecks((current) => toggleCheck(current, id));
              }}
              onExtendChecks={onExtendChecks}
              onSetDayChecks={(ids, on) => {
                setChecks((current) => setGroup(current, ids, on));
              }}
              onCursorChange={setCursor}
              onScrollOffsetChange={rememberScroll}
              onOpen={(id) => {
                library.openMeeting(id, tabOfHit(library.hits.get(id)) ?? 'Transcript');
              }}
              onOpenSummary={(id) => {
                library.openMeeting(id, 'Summary');
              }}
              onMove={(meeting) => {
                fromKeyboard.current = false;
                askMove(targetsOf(meeting));
              }}
              onDelete={(meeting) => {
                fromKeyboard.current = false;
                askDelete(targetsOf(meeting), false);
              }}
              onRowKey={onRowKey}
              onSelectAll={onSelectAll}
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
          <MeetingPreview
            state={preview}
            preferredTab={previewId === null ? null : tabOfHit(library.hits.get(previewId))}
            onOpen={library.openMeeting}
          />
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
      <MoveDialog
        {...dialogChrome}
        open={dialog?.kind === 'moveMany'}
        title={t(
          'Ui_LibraryMoveManyTitle',
          String(shown?.kind === 'moveMany' ? shown.meetings.length : 0),
        )}
        cancelLabel={t('LibraryMove_Cancel')}
        primaryLabel={t('LibraryMove_Primary')}
        destinations={library.destinations}
        currentFolderId={null}
        onMove={(folderId) => {
          if (dialog?.kind === 'moveMany') void runMoveMany(dialog.meetings, folderId);
        }}
      />
      <ConfirmDialog
        {...dialogChrome}
        open={dialog?.kind === 'deleteMany'}
        title={t(
          'Ui_LibraryDeleteManyTitle',
          String(shown?.kind === 'deleteMany' ? shown.meetingIds.length : 0),
        )}
        description={t('Ui_LibraryDeleteManyContent')}
        cancelLabel={t('HistoryDelete_Cancel')}
        primaryLabel={t('HistoryDelete_Primary')}
        onConfirm={() => {
          if (dialog?.kind === 'deleteMany') void runDeleteMany(dialog.meetingIds, 'trash');
        }}
      />
      <ConfirmDialog
        {...dialogChrome}
        open={dialog?.kind === 'deleteManyPermanently'}
        title={t('Ui_LibraryDeletePermanentTitle')}
        description={t(
          shown?.kind === 'deleteManyPermanently' && !shown.refused
            ? 'Ui_LibraryDeleteManyPermanent'
            : 'Ui_LibraryDeleteManyRefused',
          String(shown?.kind === 'deleteManyPermanently' ? shown.meetingIds.length : 0),
        )}
        cancelLabel={t('HistoryDelete_Cancel')}
        primaryLabel={t('Ui_LibraryDeletePermanentPrimary')}
        onConfirm={() => {
          if (dialog?.kind === 'deleteManyPermanently') {
            void runDeleteMany(dialog.meetingIds, 'permanent');
          }
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
            if (outcome === 'trash-failed') {
              setDialog({ kind: 'deleteMeetingPermanently', meeting, refused: true });
            }
            afterWork();
          });
        }}
      />
      <ConfirmDialog
        {...dialogChrome}
        open={dialog?.kind === 'deleteMeetingPermanently'}
        title={t('Ui_LibraryDeletePermanentTitle')}
        description={t(
          shown?.kind === 'deleteMeetingPermanently' && !shown.refused
            ? 'Ui_LibraryDeletePermanentDirect'
            : 'Ui_LibraryDeletePermanentContent',
          shown?.kind === 'deleteMeetingPermanently' ? shown.meeting.title : '',
        )}
        cancelLabel={t('HistoryDelete_Cancel')}
        primaryLabel={t('Ui_LibraryDeletePermanentPrimary')}
        onConfirm={() => {
          if (dialog?.kind === 'deleteMeetingPermanently') {
            void library.deleteMeeting(dialog.meeting.id, 'permanent').then(afterWork);
          }
        }}
      />
      <RenameDialog
        open={dialog?.kind === 'renameMeeting'}
        currentTitle={shown?.kind === 'renameMeeting' ? shown.meeting.title : ''}
        problem={renameProblem}
        busy={renameBusy}
        onSubmit={(title) => {
          if (dialog?.kind === 'renameMeeting') void renameMeeting(dialog.meeting.id, title);
        }}
        onClose={closeDialog}
      />
    </section>
  );
}
