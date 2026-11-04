import {
  libraryChanged,
  libraryChooseLocation,
  libraryCreateFolder,
  libraryDeleteFolder,
  libraryDeleteMeeting,
  libraryDeleteMeetings,
  libraryGetLocation,
  libraryGetMeeting,
  libraryIsMeetingBusy,
  libraryLoad,
  libraryMoveMeeting,
  libraryMoveMeetings,
  libraryOpenFolder,
  libraryRenameFolder,
  librarySetFolderNote,
  librarySetLocation,
  libraryUpdateFolderPersonality,
  settingsGet,
  settingsUpdate,
  workspaceCallPromptOffered,
  workspaceChanged,
  workspaceDispatch,
  workspaceGetState,
  workspaceMeetingChanged,
  workspaceMeetingDeleted,
  workspaceNavigationRequested,
  workspaceTakeNotesRequested,
  type EventChannel,
  type PayloadInputOf,
  type WorkspaceActionDto,
} from '@vozella/contracts';
import { MeetingFormatError, type Workspace } from '@vozella/core';
import type { LibraryRuntime } from '@vozella/platform';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export type Broadcast = <C extends EventChannel>(channel: C, payload: PayloadInputOf<C>) => void;

export interface LibraryHandlerDeps {
  readonly server: IpcServerDeps;
  readonly runtime: LibraryRuntime;
  readonly workspace: Workspace;
  readonly broadcast: Broadcast;
}

/** Pushes workspace changes to every window. Returns the unsubscribe function. */
export function bridgeWorkspace(workspace: Workspace, broadcast: Broadcast): () => void {
  const offs = [
    workspace.on('scopeChanged', () => {
      broadcast(workspaceChanged, { state: workspace.state });
    }),
    workspace.on('navigationRequested', (tag) => {
      broadcast(workspaceNavigationRequested, { tag });
    }),
    workspace.on('meetingDeleted', (id) => {
      broadcast(workspaceMeetingDeleted, { id });
    }),
    workspace.on('meetingChanged', (id) => {
      broadcast(workspaceMeetingChanged, { id });
    }),
    workspace.on('takeNotesRequested', () => {
      broadcast(workspaceTakeNotesRequested, {});
    }),
    workspace.on('callPromptOffered', () => {
      broadcast(workspaceCallPromptOffered, {});
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** Applies one action to the workspace. Pure routing; the rules live in core. */
export function applyWorkspaceAction(
  workspace: Workspace,
  action: WorkspaceActionDto,
): { takeNotes?: { pending: boolean; calendarEventId: string | null } } {
  switch (action.type) {
    case 'selectMeeting':
      workspace.selectMeeting(action.id);
      break;
    case 'clearSelection':
      workspace.clearSelection();
      break;
    case 'setLastProcessed':
      workspace.setLastProcessed(action.id);
      break;
    case 'setSessionTab':
      workspace.setSessionTab(action.tab);
      break;
    case 'setCurrentShellTag':
      workspace.setCurrentShellTag(action.tag);
      break;
    case 'navigateTo':
      workspace.navigateTo(action.tag);
      break;
    case 'openSession':
      workspace.openSession(action.tab);
      break;
    case 'publishSelectedFolder':
      workspace.publishSelectedFolder(action.folderId);
      break;
    case 'setLiveTranscript':
      workspace.setLiveTranscript(action.text);
      break;
    case 'setCaptureActive':
      workspace.setCaptureActive(action.active);
      break;
    case 'requestTakeNotes':
      workspace.requestTakeNotes(action.calendarEventId);
      break;
    case 'consumeTakeNotes':
      return { takeNotes: workspace.consumeTakeNotes() };
    case 'notifyMeetingChanged':
      workspace.notifyMeetingChanged(action.id);
      break;
  }
  return {};
}

export interface LibraryWrites {
  /** Resolves once every library write received so far has finished, failed or not. */
  readonly settled: () => Promise<void>;
}

/** Wires the library, settings and workspace channels. One line per channel. */
export function registerLibraryHandlers(deps: LibraryHandlerDeps): LibraryWrites {
  const { server, runtime, workspace, broadcast } = deps;
  const writes = new Set<Promise<unknown>>();
  /** Remembers a library write until it ends, so a quit can wait for it (B16). */
  const track = <T>(write: Promise<T>): Promise<T> => {
    writes.add(write);
    const done = (): void => {
      writes.delete(write);
    };
    write.then(done, done);
    return write;
  };

  registerRequest(server, libraryLoad, () => runtime.service.load());

  registerRequest(server, libraryGetMeeting, async ({ id }) => {
    try {
      return { record: await runtime.meetings.get(id) };
    } catch (error) {
      if (error instanceof MeetingFormatError) return { record: null };
      throw error;
    }
  });

  registerRequest(server, libraryCreateFolder, async (input) => {
    const result = await track(runtime.service.createFolder(input));
    if (result.ok) broadcast(libraryChanged, { reason: 'folder' });
    return result;
  });

  registerRequest(server, libraryRenameFolder, async (input) => {
    const result = await track(runtime.service.renameFolder(input));
    if (result.ok) broadcast(libraryChanged, { reason: 'folder' });
    return result;
  });

  registerRequest(server, libraryUpdateFolderPersonality, async (input) => {
    const result = await track(runtime.service.updatePersonality(input));
    if (result.ok) broadcast(libraryChanged, { reason: 'folder' });
    return result;
  });

  registerRequest(server, librarySetFolderNote, async (input) => {
    const result = await track(runtime.service.setFolderNote(input));
    if (result.ok) broadcast(libraryChanged, { reason: 'folder' });
    return result;
  });

  registerRequest(server, libraryDeleteFolder, async ({ id }) => {
    const result = await track(runtime.service.deleteFolder(id));
    if (result.ok) {
      workspace.publishSelectedFolder(null);
      broadcast(libraryChanged, { reason: 'folder' });
    }
    return result;
  });

  registerRequest(server, libraryMoveMeeting, async (input) => {
    const result = await track(runtime.service.moveMeeting(input));
    if (result.ok) {
      workspace.notifyMeetingChanged(input.meetingId);
      broadcast(libraryChanged, { reason: 'meeting' });
    }
    return result;
  });

  registerRequest(server, libraryDeleteMeeting, async ({ meetingId, mode }) => {
    const result = await track(runtime.service.deleteMeeting(meetingId, mode));
    if (result.ok) {
      workspace.notifyDeleted(meetingId);
      broadcast(libraryChanged, { reason: 'meeting' });
    }
    return result;
  });

  registerRequest(server, libraryMoveMeetings, async (input) => {
    const results = await track(runtime.service.moveMeetings(input));
    const moved = results.filter((result) => result.ok);
    for (const { meetingId } of moved) workspace.notifyMeetingChanged(meetingId);
    if (moved.length > 0) broadcast(libraryChanged, { reason: 'meeting' });
    return { results };
  });

  registerRequest(server, libraryDeleteMeetings, async (input) => {
    const results = await track(runtime.service.deleteMeetings(input));
    const deleted = results.filter((result) => result.ok);
    for (const { meetingId } of deleted) workspace.notifyDeleted(meetingId);
    if (deleted.length > 0) broadcast(libraryChanged, { reason: 'meeting' });
    return { results };
  });

  registerRequest(server, libraryIsMeetingBusy, ({ meetingId }) => ({
    busy: runtime.service.isMeetingBusy(meetingId),
  }));

  registerRequest(server, libraryGetLocation, () => runtime.location());
  registerRequest(server, libraryOpenFolder, () => runtime.openFolder());
  registerRequest(server, libraryChooseLocation, () => runtime.chooseLocation());
  registerRequest(server, librarySetLocation, ({ path }) => runtime.setLocation(path));

  registerRequest(server, settingsGet, () => runtime.settings.load());
  registerRequest(server, settingsUpdate, ({ patch }) => runtime.settings.update(patch));

  registerRequest(server, workspaceGetState, () => workspace.state);
  registerRequest(server, workspaceDispatch, ({ action }) => {
    const result = applyWorkspaceAction(workspace, action);
    return { state: workspace.state, ...result };
  });

  return {
    settled: async () => {
      while (writes.size > 0) await Promise.allSettled([...writes]);
    },
  };
}
