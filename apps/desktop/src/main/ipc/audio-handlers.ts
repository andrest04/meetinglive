import fs from 'node:fs';
import {
  audioImportPickFile,
  audioMicrophonesLoad,
  audioMicrophonesRemember,
  audioPreviewStart,
  audioPreviewStop,
  audioSourcesCloseFallback,
  audioSourcesDismissSuggestion,
  audioSourcesSelect,
  audioSourcesStart,
  audioSourcesStop,
} from '@vozella/contracts';
import { IMPORT_EXTENSIONS, importRecordedAt } from '@vozella/core';
import type { AudioController } from '../audio/audio-controller';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface AudioHandlerDeps {
  readonly server: IpcServerDeps;
  readonly controller: AudioController;
  /** Shows the file picker with the import extensions; null when cancelled. */
  readonly pickAudioFile: (extensions: readonly string[]) => Promise<string | null>;
  readonly nowMs?: () => number;
}

/** Wires the audio channels. One line per channel; the rules live in core. */
export function registerAudioHandlers(deps: AudioHandlerDeps): void {
  const { server, controller } = deps;
  const now = deps.nowMs ?? ((): number => Date.now());

  registerRequest(server, audioMicrophonesLoad, ({ userChoice }) =>
    controller.loadMicrophones(userChoice),
  );
  registerRequest(server, audioMicrophonesRemember, async ({ choice }) => ({
    saved: await controller.rememberMicrophone(choice),
  }));
  registerRequest(server, audioSourcesStart, () => controller.startSources());
  registerRequest(server, audioSourcesStop, () => {
    controller.stopSources();
    return { stopped: true as const };
  });
  registerRequest(server, audioSourcesSelect, ({ processId }) => controller.select(processId));
  registerRequest(server, audioSourcesDismissSuggestion, ({ processId }) =>
    controller.dismissSuggestion(processId),
  );
  registerRequest(server, audioSourcesCloseFallback, () => controller.closeFallback());
  registerRequest(server, audioPreviewStart, ({ deviceId }) => {
    controller.startPreview(deviceId);
    return { started: true as const };
  });
  registerRequest(server, audioPreviewStop, () => {
    controller.stopPreview();
    return { stopped: true as const };
  });
  registerRequest(server, audioImportPickFile, async () => {
    const file = await deps.pickAudioFile(IMPORT_EXTENSIONS);
    if (file === null) return null;
    let lastWrite: number | null = null;
    try {
      lastWrite = fs.statSync(file).mtimeMs;
    } catch {
      // Unreadable: the meeting time falls back to now.
    }
    return { path: file, recordedAtMs: importRecordedAt(lastWrite, now()) };
  });
}
