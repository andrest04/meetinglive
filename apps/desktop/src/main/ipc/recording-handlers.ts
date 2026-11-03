import {
  recordingCancelProcessing,
  recordingCloseAnswer,
  recordingDiscard,
  recordingGetState,
  recordingHighlight,
  recordingImport,
  recordingPause,
  recordingRetryProcessing,
  recordingResume,
  recordingSetNotes,
  recordingStart,
  recordingStop,
} from '@vozella/contracts';
import type { RendererCloseDialogs } from '../recording/close-guard';
import { registerLiveAskHandlers, type LiveAsk } from '../recording/live-ask-handlers';
import type { RecordingService } from '../recording/recording-service';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface RecordingHandlerDeps {
  readonly server: IpcServerDeps;
  readonly service: RecordingService;
  readonly closeDialogs: Pick<RendererCloseDialogs, 'answer'>;
  readonly liveAsk: LiveAsk;
}

/** Wires the recording channels. One line per channel; the rules live in the service. */
export function registerRecordingHandlers({
  server,
  service,
  closeDialogs,
  liveAsk,
}: RecordingHandlerDeps): void {
  registerLiveAskHandlers(server, liveAsk);
  registerRequest(server, recordingGetState, () => service.getState());
  registerRequest(server, recordingStart, async (input) => {
    const result = await service.start(input);
    return result;
  });
  registerRequest(server, recordingPause, async () => ({ paused: await service.pause() }));
  registerRequest(server, recordingResume, async () => ({ resumed: await service.resume() }));
  registerRequest(server, recordingStop, async () => ({ stopped: await service.stop() }));
  registerRequest(server, recordingDiscard, async () => ({ discarded: await service.discard() }));
  registerRequest(server, recordingHighlight, () => service.highlight());
  registerRequest(server, recordingSetNotes, ({ text }) => ({
    accepted: service.setNotes(text),
  }));
  registerRequest(server, recordingCancelProcessing, ({ meetingId }) => ({
    cancelled: service.cancelProcessing(meetingId),
  }));
  registerRequest(server, recordingRetryProcessing, () => ({ started: service.retryProcessing() }));
  registerRequest(server, recordingImport, (input) => service.importAudio(input));
  registerRequest(server, recordingCloseAnswer, ({ requestId, accepted }) => ({
    received: closeDialogs.answer(requestId, accepted),
  }));
}
