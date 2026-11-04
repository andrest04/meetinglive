import type { ShellTag, WorkspaceState } from '../library/workspace';

export type ChatScopeKind = 'AllMeetings' | 'Folder' | 'Meeting' | 'Live';
export type ChatSurface = ShellTag | 'Unknown';

export interface ChatScopeDecision {
  readonly isVisible: boolean;
  readonly kind: ChatScopeKind;
  readonly folderId: string | null;
  readonly meetingId: string | null;
}

/** The scope fields a stored thread carries. */
export interface ThreadScope {
  readonly scopeKind: ChatScopeKind;
  readonly folderId?: string | null;
  readonly meetingId?: string | null;
}

/** Exact, case-sensitive; anything else, including null, is Unknown (spec 3.2). */
export function parseSurface(tag: string | null | undefined): ChatSurface {
  switch (tag) {
    case 'Recording':
    case 'History':
    case 'Settings':
    case 'Session':
      return tag;
    default:
      return 'Unknown';
  }
}

/** First match wins: Settings, capture active, Session with meeting, History with folder, all. */
export function resolveScope(
  surface: ChatSurface,
  isCaptureActive: boolean,
  selectedFolderId: string | null,
  selectedMeetingId: string | null,
): ChatScopeDecision {
  if (surface === 'Settings') {
    return { isVisible: false, kind: 'AllMeetings', folderId: null, meetingId: null };
  }
  if (isCaptureActive) return { isVisible: true, kind: 'Live', folderId: null, meetingId: null };
  if (surface === 'Session' && selectedMeetingId !== null) {
    return { isVisible: true, kind: 'Meeting', folderId: null, meetingId: selectedMeetingId };
  }
  if (surface === 'History' && selectedFolderId !== null) {
    return { isVisible: true, kind: 'Folder', folderId: selectedFolderId, meetingId: null };
  }
  return { isVisible: true, kind: 'AllMeetings', folderId: null, meetingId: null };
}

/** Convenience over the shared Workspace snapshot. */
export function resolveScopeFromWorkspace(
  state: Pick<
    WorkspaceState,
    'currentShellTag' | 'isCaptureActive' | 'selectedFolderId' | 'selectedMeetingId'
  >,
): ChatScopeDecision {
  return resolveScope(
    parseSurface(state.currentShellTag),
    state.isCaptureActive,
    state.selectedFolderId,
    state.selectedMeetingId,
  );
}

/** Kind, folder id and meeting id equal, with null equal to null. A mismatch never edits the thread. */
export function matchesOpenThread(thread: ThreadScope, decision: ChatScopeDecision): boolean {
  return (
    thread.scopeKind === decision.kind &&
    (thread.folderId ?? null) === decision.folderId &&
    (thread.meetingId ?? null) === decision.meetingId
  );
}

/** Whether two decisions are the same scope (used to collapse the bar on change). */
export function sameScope(a: ChatScopeDecision, b: ChatScopeDecision): boolean {
  return a.kind === b.kind && a.folderId === b.folderId && a.meetingId === b.meetingId;
}
