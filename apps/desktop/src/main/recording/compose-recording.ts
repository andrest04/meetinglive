import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  cliExecutableName,
  defaultMeetingTitle,
  findSummaryModel,
  RecordingPipeline,
  SummaryStage,
  type CliPathProbe,
  type Logger,
  type LocalModelStore,
  type OfflineTranscriber,
  type PreviousAudioKeeper,
  type SettingsStore,
  type SummaryProviderResolver,
  type SummaryService,
  type TranslateFn,
  type Workspace,
  type CatalogLocale,
} from '@vozella/core';
import { directoryFor, repairWavFile, samePath, type LibraryRuntime } from '@vozella/platform';
import type { Broadcast } from '../ipc/library-handlers';
import type { AudioController } from '../audio/audio-controller';
import type { RecordingTakes } from '../audio/recording-take';
import type { TranscriptionController } from '../transcription/transcription-controller';
import { RecordingService } from './recording-service';

export interface ComposeRecordingDeps {
  readonly library: LibraryRuntime;
  readonly controller: AudioController;
  readonly takes: RecordingTakes;
  readonly transcription: TranscriptionController;
  readonly summaryService: SummaryService;
  readonly resolver: SummaryProviderResolver;
  readonly summaryModels: LocalModelStore;
  readonly cli: CliPathProbe;
  readonly settings: SettingsStore;
  readonly workspace: Workspace;
  readonly broadcast: Broadcast;
  readonly logger: Logger;
  readonly translate: TranslateFn;
  readonly locale: () => CatalogLocale;
  readonly titleCatalog: (locale: CatalogLocale) => {
    MeetingTitleFormat: string;
    MeetingTitleDateFormat: string;
  };
  readonly formatFailure: (error: unknown) => string;
  readonly wavDurationSeconds: (file: string) => number;
}

/** Renames the audio a new take replaces to `<stem> (previous).wav` beside it (B-3). */
function previousAudioKeeper(): PreviousAudioKeeper {
  return {
    keep: (audioPath) => {
      if (!fs.existsSync(audioPath)) return Promise.resolve(audioPath);
      const dot = audioPath.lastIndexOf('.');
      const stem = dot < 0 ? audioPath : audioPath.slice(0, dot);
      const ext = dot < 0 ? '' : audioPath.slice(dot);
      for (let n = 1; ; n += 1) {
        const candidate = `${stem} (previous${n === 1 ? '' : ` ${n}`})${ext}`;
        if (fs.existsSync(candidate)) continue;
        fs.renameSync(audioPath, candidate);
        return Promise.resolve(candidate);
      }
    },
  };
}

/** The offline pass of the transcription module as the pipeline's port (188: repair first). */
function offlineTranscriber(transcription: TranscriptionController): OfflineTranscriber {
  return {
    isReady: async () => (await transcription.status()).ready,
    transcribe: (request) => {
      repairWavFile(request.audioPath);
      return transcription.transcribeFile({
        audioPath: request.audioPath,
        recordedAtMs: request.recordedAtMs,
        onProgress: request.onProgress,
        cancel: request.cancel,
      });
    },
  };
}

/** Builds the pipeline and the service from the pieces the composition root owns. */
export function composeRecording(deps: ComposeRecordingDeps): RecordingService {
  const { library } = deps;
  const summary = new SummaryStage({
    settings: deps.settings,
    resolver: deps.resolver,
    generator: deps.summaryService,
    translate: deps.translate,
  });
  const pipeline = new RecordingPipeline({
    meetings: library.meetings,
    settings: deps.settings,
    transcriber: offlineTranscriber(deps.transcription),
    formatFailure: deps.formatFailure,
    previousAudio: previousAudioKeeper(),
    summary,
  });
  return new RecordingService({
    takes: deps.takes,
    controller: deps.controller,
    library: {
      audioDirectory: async (folderId) =>
        directoryFor(library.libraryRoot, await library.folders.getAll(), folderId),
      folderExists: async (folderId) =>
        (await library.folders.getAll()).some((folder) => folder.id === folderId),
      ownsMarkdown: async (meetingId, markdownPath) =>
        (await library.meetings.locate(meetingId)).some((entry) =>
          samePath(entry.path, markdownPath),
        ),
    },
    files: {
      remove: (file) => {
        fs.rmSync(file, { force: true });
      },
      fileTimeMs: (file) => {
        try {
          return fs.statSync(file).mtimeMs;
        } catch {
          return null;
        }
      },
      wavDurationSeconds: deps.wavDurationSeconds,
      repair: (file) => {
        repairWavFile(file);
      },
    },
    settings: deps.settings,
    setup: {
      loadSettings: () => deps.settings.load(),
      localModelFileExists: (fileName) => {
        const model = findSummaryModel(fileName);
        return model === null ? Promise.resolve(false) : deps.summaryModels.isDownloaded(model);
      },
      cliOnPath: (kind) => deps.cli.isOnPath(cliExecutableName(kind)),
      engineReady: async () => (await deps.transcription.status()).ready,
    },
    pipeline,
    workspace: deps.workspace,
    live: { onUpdate: (listener) => deps.transcription.onLiveUpdate(listener) },
    broadcast: deps.broadcast,
    logger: deps.logger,
    nowMs: () => Date.now(),
    newId: () => randomUUID(),
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => {
        clearTimeout(timer);
      };
    },
    defaultTitle: (atMs) => {
      const locale = deps.locale();
      return defaultMeetingTitle(new Date(atMs), locale, deps.titleCatalog(locale));
    },
  });
}
