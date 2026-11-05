import { resolveAccentKey, resolveIconKey } from '@vozella/core';
import type { MeetingListItemDto } from '@vozella/contracts';
import { Ellipsis, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
  Icon,
  Menu,
  Field,
} from '../../ui';
import { Breadcrumbs } from './Breadcrumbs';
import { ConfirmDialog, MoveDialog, NameDialog, PersonalityDialog } from './dialogs';
import { clearFolderRequest, useLibraryStore, type FolderRequest } from './library-store';
import { folderMenuEntries } from './LibraryFolders';
import { MeetingList } from './MeetingList';
import { describeSkipped } from './format';
import { useLibrary, type StatusMessage } from './use-library';

type DialogState =
  | { readonly kind: 'newFolder' }
  | { readonly kind: 'rename'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'personality'; readonly folderId: string }
  | { readonly kind: 'deleteFolder'; readonly folderId: string; readonly name: string }
  | { readonly kind: 'move'; readonly meeting: MeetingListItemDto }
  | { readonly kind: 'deleteMeeting'; readonly meeting: MeetingListItemDto }
  | { readonly kind: 'deleteMeetingPermanently'; readonly meeting: MeetingListItemDto };

/** The Library page: breadcrumbs, search, the meeting list and the dialogs of the folders. */
export function LibraryRoute() {
  const { t, locale } = useI18n();
  const library = useLibrary(locale, t('Library_Inbox'));
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
    <section className="relative flex flex-col gap-5">
      <div className="flex items-end justify-between gap-4">
        <SectionHeader level={1} quiet title={t('HistoryPage_Title.Text')} />
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

      <div className="relative">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-1">
              <Breadcrumbs
                crumbs={crumbs}
                label={t('Chat_ScopeFolder')}
                onSelect={library.selectFolder}
              />
              {library.selectedFolder ? (
                <Menu
                  align="start"
                  entries={folderMenuEntries(t, library.selectedFolder.id, runFolderAction)}
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
