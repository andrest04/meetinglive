import fs from 'node:fs';
import {
  audioAppIcon,
  audioImportPickFile,
  audioImportRun,
  audioMicrophonesLoad,
  audioMicrophonesRemember,
  audioPreviewStart,
  audioPreviewStop,
  audioRecordingPause,
  audioRecordingResume,
  audioRecordingStart,
  audioRecordingState,
  audioRecordingStop,
  audioSourcesCloseFallback,
  audioSourcesDismissSuggestion,
  audioSourcesSelect,
  audioSourcesStart,
  audioSourcesStop,
} from '@vozella/contracts';
import { IMPORT_EXTENSIONS, importRecordedAt } from '@vozella/core';
import type { AudioController } from '../audio/audio-controller';
import type { RecordingTakes } from '../audio/recording-take';
import { registerRequest, type IpcServerDeps } from './ipc-server';

export interface AudioHandlerDeps {
  readonly server: IpcServerDeps;
  readonly controller: AudioController;
  /** Starts, pauses and stops the take and runs the import; it owns the file path. */
  readonly takes: RecordingTakes;
  /** The executable's icon as a data URL, or null. */
  readonly appIcon: (exePath: string) => Promise<string | null>;
  /** Shows the file picker with the import extensions; null when cancelled. */
  readonly pickAudioFile: (extensions: readonly string[]) => Promise<string | null>;
  readonly nowMs?: () => number;
}

/** Wires the audio channels. One line per channel; the rules live in core. */
export function registerAudioHandlers(deps: AudioHandlerDeps): void {
  const { server, controller, takes } = deps;
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
    // Spec item 92: the preview never competes with a take for the microphone.
    if (!takes.busy) controller.startPreview(deviceId);
    return { started: true as const };
  });
  registerRequest(server, audioPreviewStop, () => {
    controller.stopPreview();
    return { stopped: true as const };
  });
  registerRequest(server, audioImportPickFile, async () => {
    const file = await deps.pickAudioFile(IMPORT_EXTENSIONS);
    if (file === null) {
      takes.rememberPick(null);
      return null;
    }
    let lastWrite: number | null = null;
    try {
      lastWrite = fs.statSync(file).mtimeMs;
    } catch {
      // Unreadable: the meeting time falls back to now.
    }
    const recordedAtMs = importRecordedAt(lastWrite, now());
    takes.rememberPick({ path: file, recordedAtMs });
    return { path: file, recordedAtMs };
  });
  registerRequest(server, audioImportRun, ({ title }) => takes.importPicked(title));
  registerRequest(server, audioRecordingStart, ({ title, microphone }) =>
    takes.start(title, microphone),
  );
  registerRequest(server, audioRecordingState, () => ({ phase: takes.currentPhase }));
  registerRequest(server, audioRecordingPause, async () => ({ paused: await takes.pause() }));
  registerRequest(server, audioRecordingResume, async () => ({ resumed: await takes.resume() }));
  registerRequest(server, audioRecordingStop, () => takes.stop());
  registerRequest(server, audioAppIcon, async ({ exePath }) => ({
    dataUrl: await deps.appIcon(exePath),
  }));
}
