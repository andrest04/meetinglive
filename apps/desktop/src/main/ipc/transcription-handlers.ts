import {
  retranscriptionAvailability,
  retranscriptionCancel,
  retranscriptionGetState,
  retranscriptionStart,
  transcriptionCancelInstall,
  transcriptionDeleteEngine,
  transcriptionDeleteSpeakerModel,
  transcriptionDownloadSpeakerModel,
  transcriptionEnsureEngine,
  transcriptionGetStatus,
  transcriptionSetLiveEnabled,
  transcriptionSetSpeakerLabels,
} from '@vozella/contracts';
import type { TranscriptionController } from '../transcription/transcription-controller';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface TranscriptionHandlerDeps {
  readonly server: IpcServerDeps;
  readonly controller: TranscriptionController;
}

/** Wires the transcription channels. One line per channel; the rules live in core. */
export function registerTranscriptionHandlers(deps: TranscriptionHandlerDeps): void {
  const { server, controller } = deps;

  registerRequest(server, transcriptionGetStatus, () => controller.status());
  registerRequest(server, transcriptionEnsureEngine, () => controller.ensureEngine());
  registerRequest(server, transcriptionCancelInstall, () => ({
    cancelled: controller.cancelInstall(),
  }));
  registerRequest(server, transcriptionDeleteEngine, async () => ({
    outcome: await controller.deleteEngine(),
  }));
  registerRequest(server, transcriptionSetLiveEnabled, async ({ enabled }) => ({
    saved: await controller.setLiveEnabled(enabled),
  }));
  registerRequest(server, transcriptionSetSpeakerLabels, ({ enabled }) =>
    controller.setSpeakerLabels(enabled),
  );
  registerRequest(server, transcriptionDownloadSpeakerModel, () =>
    controller.downloadSpeakerModel(),
  );
  registerRequest(server, transcriptionDeleteSpeakerModel, () => controller.deleteSpeakerModel());
  registerRequest(server, retranscriptionAvailability, async ({ meetingId }) => ({
    availability: await controller.retranscriptionAvailability(meetingId),
  }));
  registerRequest(server, retranscriptionStart, ({ meetingId }) =>
    controller.startRetranscription(meetingId),
  );
  registerRequest(server, retranscriptionCancel, () => {
    controller.cancelRetranscription();
    return { cancelled: true as const };
  });
  registerRequest(server, retranscriptionGetState, () => controller.retranscription);
}
