export const SHELL_TAGS = ['Recording', 'History', 'Settings', 'Session'] as const;
export type ShellTag = (typeof SHELL_TAGS)[number];
export const SESSION_TABS = ['Transcript', 'Summary'] as const;
export type SessionTab = (typeof SESSION_TABS)[number];

export interface WorkspaceState {
  readonly selectedMeetingId: string | null;
  readonly lastProcessedMeetingId: string | null;
  readonly sessionTab: SessionTab;
  readonly currentShellTag: ShellTag;
  /** null is Inbox. */
  readonly selectedFolderId: string | null;
  readonly liveTranscript: string;
  readonly isCaptureActive: boolean;
}

export interface WorkspaceEvents {
  scopeChanged: undefined;
  meetingChanged: string;
  meetingDeleted: string;
  navigationRequested: ShellTag;
  takeNotesRequested: undefined;
  callPromptOffered: undefined;
}

type Listener<K extends keyof WorkspaceEvents> = (payload: WorkspaceEvents[K]) => void;

function isShellTag(value: string): value is ShellTag {
  return (SHELL_TAGS as readonly string[]).includes(value);
}

function isSessionTab(value: string): value is SessionTab {
  return (SESSION_TABS as readonly string[]).includes(value);
}

/**
 * App-lifetime hub (spec 4.6): selected meeting, selected Library folder, shell tag, and
 * navigation requests. Pages ask for navigation; only the shell acts on it.
 */
export class Workspace {
  private current: WorkspaceState = {
    selectedMeetingId: null,
    lastProcessedMeetingId: null,
    sessionTab: 'Transcript',
    currentShellTag: 'Recording',
    selectedFolderId: null,
    liveTranscript: '',
    isCaptureActive: false,
  };
  private takeNotesPending = false;
  private takeNotesEventId: string | null = null;
  private readonly listeners = new Map<keyof WorkspaceEvents, Set<Listener<never>>>();

  get state(): WorkspaceState {
    return this.current;
  }

  on<K extends keyof WorkspaceEvents>(event: K, listener: Listener<K>): () => void {
    const existing = this.listeners.get(event) as Set<Listener<K>> | undefined;
    const set = existing ?? new Set<Listener<K>>();
    if (!existing) this.listeners.set(event, set);
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  private emit<K extends keyof WorkspaceEvents>(event: K, payload: WorkspaceEvents[K]): void {
    const set = this.listeners.get(event) as Set<Listener<K>> | undefined;
    if (set) for (const listener of [...set]) listener(payload);
  }

  private patch(change: Partial<WorkspaceState>): void {
    this.current = { ...this.current, ...change };
  }

  setCurrentShellTag(tag: ShellTag): void {
    if (!isShellTag(tag)) throw new Error(`Unknown shell tag: ${String(tag)}`);
    if (tag === this.current.currentShellTag) return;
    this.patch({ currentShellTag: tag });
    this.emit('scopeChanged', undefined);
  }

  /** Asks the shell to navigate. Transcript and Summary are session tabs, not destinations. */
  navigateTo(tag: ShellTag): void {
    if (!isShellTag(tag)) throw new Error(`Cannot navigate to: ${String(tag)}`);
    this.emit('navigationRequested', tag);
  }

  setSessionTab(tab: SessionTab): void {
    if (!isSessionTab(tab)) throw new Error(`Unknown session tab: ${String(tab)}`);
    this.patch({ sessionTab: tab });
  }

  openSession(tab: SessionTab): void {
    this.setSessionTab(tab);
    this.navigateTo('Session');
  }

  publishSelectedFolder(folderId: string | null): void {
    this.patch({ selectedFolderId: folderId });
    this.emit('scopeChanged', undefined);
  }

  selectMeeting(id: string | null): void {
    if (id === this.current.selectedMeetingId) return;
    this.patch({ selectedMeetingId: id });
    this.emit('scopeChanged', undefined);
  }

  setLastProcessed(id: string): void {
    this.patch({ lastProcessedMeetingId: id });
    this.selectMeeting(id);
  }

  clearSelection(): void {
    if (this.current.lastProcessedMeetingId === this.current.selectedMeetingId) {
      this.patch({ lastProcessedMeetingId: null });
    }
    this.selectMeeting(null);
  }

  notifyDeleted(id: string): void {
    if (this.current.lastProcessedMeetingId === id) this.patch({ lastProcessedMeetingId: null });
    if (this.current.selectedMeetingId === id) this.selectMeeting(null);
    this.emit('meetingDeleted', id);
  }

  notifyMeetingChanged(id: string): void {
    this.emit('meetingChanged', id);
  }

  setLiveTranscript(text: string): void {
    this.patch({ liveTranscript: text });
  }

  setCaptureActive(active: boolean): void {
    if (active === this.current.isCaptureActive) return;
    this.patch({ isCaptureActive: active });
    this.emit('scopeChanged', undefined);
  }

  requestTakeNotes(calendarEventId?: string | null): void {
    this.takeNotesEventId =
      calendarEventId && calendarEventId.trim() !== '' ? calendarEventId : null;
    this.takeNotesPending = true;
    this.emit('takeNotesRequested', undefined);
    this.navigateTo('Recording');
  }

  /**
   * Puts a consumed request back when main could not act on it (setup incomplete), so the Record
   * page picks it up and shows what is missing. The page is already the destination.
   */
  restoreTakeNotes(): void {
    this.takeNotesPending = true;
    this.emit('takeNotesRequested', undefined);
  }

  consumeTakeNotes(): { pending: boolean; calendarEventId: string | null } {
    const result = { pending: this.takeNotesPending, calendarEventId: this.takeNotesEventId };
    this.takeNotesEventId = null;
    this.takeNotesPending = false;
    return result;
  }

  offerCallPrompt(): void {
    this.emit('callPromptOffered', undefined);
  }
}
