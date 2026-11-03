import type {
  FolderDto,
  MicrophoneChoiceDto,
  RecordingMessageDto,
  RecordingSetupDto,
  RecordingStateDto,
} from '@vozella/contracts';
import { create } from 'zustand';

/**
 * The Record page's state (stack.md: Zustand, the main process owns the truth). The take, the
 * pipeline and the clock live in main; this store holds what main last said (`recording.state`,
 * `recording.liveText`), the setup checklist, and the few things only the page owns: the title the
 * user typed, the destination, and the outcome of a Start or Import that main refused.
 */

export interface SourceChoice {
  readonly microphone: MicrophoneChoiceDto | null;
  readonly processId: number | null;
  readonly appName: string | null;
}

export type PageBusy = 'starting' | 'importing' | null;

export interface RecordingStore {
  /** Null until main answered. */
  readonly state: RecordingStateDto | null;
  readonly liveText: string;
  /** The part of the live transcript the engine will not rewrite (the rest is the interim tail). */
  readonly committedText: string;
  readonly setup: RecordingSetupDto | null;
  readonly folders: readonly FolderDto[];
  /** Null is the Inbox. */
  readonly folderId: string | null;
  /** What the user typed; null shows the default title for `defaultAtMs`. */
  readonly title: string | null;
  readonly defaultAtMs: number;
  /** The outcome of the last Start or Import that did not begin, or the cancelled setup. */
  readonly notice: RecordingMessageDto | null;
  readonly busy: PageBusy;
  /** A meeting whose result card was closed by a delete. */
  readonly clearedMeetingId: string | null;
}

const initial = (): RecordingStore => ({
  state: null,
  liveText: '',
  committedText: '',
  setup: null,
  folders: [],
  folderId: null,
  title: null,
  defaultAtMs: Date.now(),
  notice: null,
  busy: null,
  clearedMeetingId: null,
});

export const useRecordingStore = create<RecordingStore>(() => initial());

const set = useRecordingStore.setState;
const get = useRecordingStore.getState;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failure = (key: string, error: unknown): RecordingMessageDto => ({
  key,
  args: [errorText(error)],
  severity: 'error',
});

const isIdle = (): boolean => (get().state?.phase ?? 'Idle') === 'Idle';

/** Test seam: forget everything, as a fresh window would. */
export function resetRecordingStore(): void {
  set(initial(), true);
}

/**
 * Applies a state from main. The end of a take (back to Idle) resets the title for the next one,
 * as the WinUI run reset does (spec 2.2).
 */
export function applyRecordingState(next: RecordingStateDto): void {
  const previous = get().state;
  const ended = previous !== null && previous.phase !== 'Idle' && next.phase === 'Idle';
  const began = previous?.phase === 'Idle' && next.phase !== 'Idle';
  set({
    state: next,
    ...(began ? { committedText: '' } : {}),
    ...(ended ? { title: null, defaultAtMs: Date.now() } : {}),
  });
}

export const applyLiveText = (text: string): void => {
  set({ liveText: text });
};

export async function loadRecordingState(): Promise<void> {
  try {
    const { liveText, ...state } = await window.vozella.invoke('recording.getState', {});
    applyRecordingState(state);
    applyLiveText(liveText);
  } catch {
    // The page stays as it was; the next push fills it.
  }
}

/** Readiness: refreshed on entry, after setup, and before every Start and Import (item 18). */
export async function refreshSetup(): Promise<RecordingSetupDto | null> {
  try {
    const setup = await window.vozella.invoke('recording.getSetup', {});
    set({ setup });
    return setup;
  } catch {
    return null;
  }
}

/** The destination list reloads on every entry; the choice is kept while its folder exists. */
export async function loadFolders(): Promise<void> {
  try {
    const result = await window.vozella.invoke('library.load', {});
    if (!result.ok) return;
    const folders = result.folders;
    const { folderId } = get();
    const kept = folderId !== null && folders.some((folder) => folder.id === folderId);
    set({ folders, folderId: kept ? folderId : null });
  } catch {
    // The list stays as it was.
  }
}

export const setTitle = (title: string): void => {
  set({ title });
};
export const setFolderId = (folderId: string | null): void => {
  set({ folderId });
};
export const setNotice = (notice: RecordingMessageDto | null): void => {
  set({ notice });
};

let connections = 0;
let disconnect: (() => void) | null = null;

/**
 * Subscribes to main's events while at least one page is mounted, and loads the snapshot. The
 * store keeps its values between visits, so a page that comes back draws at once.
 */
export function connectRecording(): () => void {
  connections += 1;
  if (connections === 1) {
    const offs = [
      window.vozella.on('recording.state', applyRecordingState),
      window.vozella.on('recording.liveText', ({ text }) => {
        applyLiveText(text);
      }),
      window.vozella.on('transcription.liveUpdate', ({ committedText }) => {
        set({ committedText });
      }),
      window.vozella.on('workspace.meetingDeleted', ({ id }) => {
        if (get().state?.lastMeeting?.id === id) set({ clearedMeetingId: id });
      }),
    ];
    disconnect = () => {
      for (const off of offs) off();
    };
  }
  void loadRecordingState();
  void refreshSetup();
  void loadFolders();
  return () => {
    connections -= 1;
    if (connections === 0) {
      disconnect?.();
      disconnect = null;
    }
  };
}

export interface StartInput extends SourceChoice {
  /** The title to record under: the typed one or the default shown in the box. */
  readonly title: string;
}

/** Spec 2.5 from the page's side. Returns true when the take began. */
export async function startRecording(input: StartInput): Promise<boolean> {
  if (get().busy !== null || !isIdle()) return false;
  set({ busy: 'starting', notice: null });
  try {
    const result = await window.vozella.invoke('recording.start', {
      title: input.title,
      folderId: get().folderId,
      microphone: input.microphone,
      processId: input.processId,
      appName: input.appName,
    });
    if (result.started) return true;
    // `not-ready` has no words of its own: the setup panel says what is missing.
    if (result.reason === 'not-ready') await refreshSetup();
    set({ notice: result.message });
    return false;
  } catch (error) {
    set({ notice: failure('Error_StartRecording', error) });
    return false;
  } finally {
    set({ busy: null });
  }
}

/** Spec 2.12: pick a file, then run it through the pipeline. Cancelling the picker is silent. */
export async function importRecording(title: string): Promise<boolean> {
  if (get().busy !== null || !isIdle()) return false;
  set({ busy: 'importing', notice: null });
  try {
    const picked = await window.vozella.invoke('audio.import.pickFile', {});
    if (picked === null) return false;
    const result = await window.vozella.invoke('recording.import', {
      title,
      folderId: get().folderId,
      path: picked.path,
    });
    if (result.started) return true;
    if (result.reason === 'not-ready') await refreshSetup();
    if (result.reason !== 'cancelled') set({ notice: result.message });
    return false;
  } catch (error) {
    set({ notice: failure('Error_ImportAudio', error) });
    return false;
  } finally {
    set({ busy: null });
  }
}

async function command(name: 'pause' | 'resume' | 'stop'): Promise<void> {
  try {
    await window.vozella.invoke(`recording.${name}`, {});
  } catch {
    // Main keeps the take; the next state push says where it stands.
  }
}
export const pauseRecording = (): Promise<void> => command('pause');
export const resumeRecording = (): Promise<void> => command('resume');
export const stopRecording = (): Promise<void> => command('stop');

/** Item 68: marks this moment; the elapsed time (WAV time, pauses excluded) comes back from main. */
export async function highlightMoment(): Promise<number | null> {
  try {
    const result = await window.vozella.invoke('recording.highlight', {});
    return result.marked ? result.elapsedMs : null;
  } catch {
    return null;
  }
}

/** Item 70: puts text on the clipboard through main (the renderer clipboard is denied). */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const result = await window.vozella.invoke('summaries.writeClipboard', { text });
    return result.status === 'written';
  } catch {
    return false;
  }
}

/** Item 71, after the confirmation. */
export async function discardRecording(): Promise<void> {
  try {
    await window.vozella.invoke('recording.discard', {});
  } catch {
    // Main keeps the take; the next state push says where it stands.
  }
}

export async function cancelProcessing(): Promise<void> {
  try {
    await window.vozella.invoke('recording.cancelProcessing', { meetingId: null });
  } catch {
    // The run goes on.
  }
}

/** B-21: cancels the summary that keeps running after the hand-off, without touching the meeting. */
export async function cancelBackgroundSummary(meetingId: string): Promise<boolean> {
  try {
    const result = await window.vozella.invoke('recording.cancelProcessing', { meetingId });
    return result.cancelled;
  } catch {
    return false;
  }
}

/** B-11: runs the pipeline again on the audio of a take whose first save failed. */
export async function retryProcessing(): Promise<boolean> {
  try {
    const result = await window.vozella.invoke('recording.retryProcessing', {});
    return result.started;
  } catch {
    return false;
  }
}
