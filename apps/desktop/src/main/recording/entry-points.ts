import type {
  Logger,
  MeetingBusyRegistry,
  RecordingEntryPoints,
  StartRecordingOptions,
  Workspace,
} from '@vozella/core';
import type { RecordingService } from './recording-service';

/**
 * The small named calls other modules make into the recording (session views, the shell, the
 * pill). They hide the service, the gate and the run host behind five verbs.
 */
export function createRecordingEntryPoints(
  service: RecordingService,
  workspace: Pick<Workspace, 'state'>,
): RecordingEntryPoints {
  return {
    startRecording: async (options: StartRecordingOptions = {}) => {
      const result = await service.start(
        {
          title: options.title ?? '',
          folderId: options.folderId ?? workspace.state.selectedFolderId,
          // The page never loaded the sources: main restores the remembered ones (B-23).
          microphone: null,
          appName: null,
        },
        { meetingId: options.meetingId ?? null },
      );
      return { started: result.started, meetingId: result.started ? result.meetingId : null };
    },
    stopRecording: () => service.stop(),
    isCaptureActive: () => service.isCaptureActive,
    isMeetingInUse: (meetingId) => service.isMeetingInUse(meetingId),
    processAudioFile: (meetingId, audioPath, request) =>
      service.processAudioFile(meetingId, audioPath, request),
  };
}

/** History's delete and move refuse a meeting the recording holds (164). */
export function registerRecordingBusyProbe(
  busy: Pick<MeetingBusyRegistry, 'register'>,
  entry: Pick<RecordingEntryPoints, 'isMeetingInUse'>,
): () => void {
  return busy.register({ isBusy: (meetingId) => entry.isMeetingInUse(meetingId) });
}

/**
 * The "take notes" request (180): the call popup and the pill ask the workspace, and an idle app
 * starts a blank recording. An event id is dropped with the calendar (owner decision 2026-11-03,
 * may return later): the request is a blank take either way. Returns the unsubscribe.
 */
export function startTakeNotesRequests(
  workspace: Pick<Workspace, 'on' | 'consumeTakeNotes' | 'state'>,
  entry: Pick<RecordingEntryPoints, 'startRecording'>,
  logger: Logger,
): () => void {
  return workspace.on('takeNotesRequested', () => {
    if (!workspace.consumeTakeNotes().pending) return;
    // A take or a run already holds the session: `start` answers busy and nothing changes.
    entry.startRecording().catch((error: unknown) => {
      logger.warn('the take-notes request did not start a recording', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
