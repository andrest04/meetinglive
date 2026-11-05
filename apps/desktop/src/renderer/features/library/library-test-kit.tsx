import type { WorkspaceActionDto } from '@vozella/contracts';
import {
  InMemoryFolderRepository,
  InMemoryMeetingRepository,
  LibraryService,
  MeetingBusyRegistry,
  Workspace,
  type FolderRecord,
  type MeetingRecord,
} from '@vozella/core';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '../../i18n/I18nProvider';
import type { Locale } from '../../i18n/translate';
import { TooltipProvider } from '../../ui';
import { connectLibrary } from './library-store';
import { LibraryFolders } from './LibraryFolders';
import { LibraryRoute } from './LibraryRoute';

type Listener = (payload: unknown) => void;

export const meetingRecord = (
  id: string,
  title: string,
  recordedAt: string,
  extra: Partial<MeetingRecord> = {},
): MeetingRecord => ({
  id,
  title,
  recordedAt,
  endedAt: null,
  audioFilePath: '',
  sourcePath: null,
  folderId: null,
  summaryProvider: null,
  calendarEventId: null,
  calendarId: null,
  seriesId: null,
  joinUrl: null,
  noteTemplateId: null,
  attendees: [],
  brief: null,
  transcript: null,
  summary: null,
  actionItems: [],
  jevAnalysis: null,
  notes: null,
  followUp: null,
  projectPlan: null,
  ...extra,
});

export const folderRecord = (
  id: string,
  name: string,
  parentId: string | null = null,
  extra: Partial<FolderRecord> = {},
): FolderRecord => ({
  id,
  name,
  parentId,
  note: null,
  colorKey: null,
  iconKey: null,
  createdAt: '2026-09-01T12:00:00+00:00',
  ...extra,
});

/**
 * A `window.vozella` backed by the real Library service over in-memory repositories and the
 * real workspace hub, so page tests exercise the same rules the main process applies.
 */
export function installFakeApi(options: { startupError?: string | null } = {}) {
  const meetings = new InMemoryMeetingRepository();
  const folders = new InMemoryFolderRepository();
  const busy = new MeetingBusyRegistry();
  const workspace = new Workspace();
  let counter = 0;
  const service = new LibraryService({
    meetings,
    folders,
    busy,
    clock: { now: () => new Date('2026-09-05T15:00:00.000Z') },
    newId: () => `00000000-0000-4000-8000-${String((counter += 1)).padStart(12, '0')}`,
  });
  const listeners = new Map<string, Set<Listener>>();
  const calls: { name: string; input: unknown }[] = [];
  const actions: WorkspaceActionDto[] = [];

  const emit = (name: string, payload: unknown): void => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };

  const invoke = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    calls.push({ name, input });
    switch (name) {
      case 'library.load':
        return service.load();
      case 'library.getLocation':
        return { startupError: options.startupError ?? null };
      case 'library.createFolder': {
        const result = await service.createFolder(input as never);
        if (result.ok) emit('library.changed', { reason: 'folder' });
        return result;
      }
      case 'library.renameFolder': {
        const result = await service.renameFolder(input as never);
        if (result.ok) emit('library.changed', { reason: 'folder' });
        return result;
      }
      case 'library.updateFolderPersonality': {
        const result = await service.updatePersonality(input as never);
        if (result.ok) emit('library.changed', { reason: 'folder' });
        return result;
      }
      case 'library.setFolderNote': {
        const result = await service.setFolderNote(input as never);
        if (result.ok) emit('library.changed', { reason: 'folder' });
        return result;
      }
      case 'library.deleteFolder': {
        const result = await service.deleteFolder(input.id as string);
        if (result.ok) {
          workspace.publishSelectedFolder(null);
          emit('library.changed', { reason: 'folder' });
        }
        return result;
      }
      case 'library.moveMeeting': {
        const result = await service.moveMeeting(input as never);
        if (result.ok) emit('library.changed', { reason: 'meeting' });
        return result;
      }
      case 'library.deleteMeeting': {
        const result = await service.deleteMeeting(
          input.meetingId as string,
          input.mode as 'trash' | 'permanent' | undefined,
        );
        if (result.ok) emit('library.changed', { reason: 'meeting' });
        return result;
      }
      case 'library.isMeetingBusy':
        return { busy: service.isMeetingBusy(input.meetingId as string) };
      case 'library.getMeeting':
        return { record: await meetings.get(input.id as string) };
      case 'workspace.getState':
        return workspace.state;
      case 'workspace.dispatch': {
        const action = input.action as WorkspaceActionDto;
        actions.push(action);
        if (action.type === 'selectMeeting') workspace.selectMeeting(action.id);
        else if (action.type === 'openSession') workspace.openSession(action.tab);
        else if (action.type === 'navigateTo') workspace.navigateTo(action.tag);
        else if (action.type === 'publishSelectedFolder') {
          workspace.publishSelectedFolder(action.folderId);
        }
        return { state: workspace.state };
      }
      default:
        throw new Error(`fake api: unhandled ${name}`);
    }
  };

  const api = {
    invoke,
    on: (name: string, listener: Listener) => {
      const set = listeners.get(name) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(name, set);
      return () => {
        set.delete(listener);
      };
    },
  };
  Object.defineProperty(window, 'vozella', { value: api, configurable: true, writable: true });

  return { meetings, folders, busy, workspace, calls, actions, emit, service };
}

export function Providers({ children, locale = 'en' }: { children: ReactNode; locale?: Locale }) {
  return (
    <I18nProvider initialLocale={locale}>
      <TooltipProvider delay={0}>{children}</TooltipProvider>
    </I18nProvider>
  );
}

/** The Library as the shell shows it: the connected store, the sidebar tree and the route. */
export function LibraryScreen() {
  useEffect(() => connectLibrary(), []);
  return (
    <>
      <LibraryFolders location="library" />
      <LibraryRoute />
    </>
  );
}
