import type { InstallStage } from './engine-installer';

/**
 * Catalog keys for what the download is doing. The installer reports a stage, not words, so the
 * page can say it in the user's language (B25).
 */
export const INSTALL_STAGE_LABEL_KEYS: Readonly<Record<InstallStage | 'speaker-model', string>> = {
  'runtime-cuda': 'Ui_EngineStageRuntimeCuda',
  'runtime-cpu': 'Ui_EngineStageRuntimeCpu',
  'runtime-cpu-fallback': 'Ui_EngineStageRuntimeCpuFallback',
  model: 'Ui_EngineStageModel',
  'speaker-model': 'Status_DownloadingSpeakerModel',
};

/** Shown when speaker labels are on but the model is not installed (B7). */
export const SPEAKER_MODEL_MISSING_KEY = 'Ui_SpeakerModelMissing';
