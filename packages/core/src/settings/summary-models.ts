import { formatTemplate, type CatalogLocale } from '../i18n/format';

/** What the machine can run. From the hardware probe (spec contract `HardwareProfile`). */
export interface HardwareProfile {
  readonly totalRamGb: number;
  readonly gpuName: string | null;
  readonly gpuVramGb: number | null;
  /** False when the GPU query failed, so "no GPU" is a guess and must not be kept (B17). */
  readonly gpuReadComplete?: boolean;
}

export type FitRating = 'Recommended' | 'MayBeSlow' | 'NotRecommended';

export interface SummaryModelInfo {
  /** The persisted id and the file name on disk. */
  readonly fileName: string;
  readonly displayName: string;
  readonly downloadUrl: string;
  readonly fileSizeGb: number;
  /** The exact size the host reports (Content-Length, recorded 2026-11-03). "Downloaded" means the file has it (B18). */
  readonly sizeBytes: number;
  /** Lowercase hex SHA-256 when pinned; only the 1B file is, the others were never downloaded here. */
  readonly sha256?: string;
  readonly minRamGb: number;
  /** Catalog keys. The text is looked up when it is drawn, so a language change relabels them (B9). */
  readonly speedKey: string;
  readonly qualityKey: string;
  readonly useCaseKey: string;
}

/** Curated Q4_K_M GGUF models, ascending by minimum RAM. Spec 2.4. */
export const SUMMARY_MODELS: readonly SummaryModelInfo[] = [
  {
    fileName: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    displayName: 'Llama 3.2 1B Instruct',
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    fileSizeGb: 0.81,
    sizeBytes: 807694464,
    sha256: '6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83',
    minRamGb: 4,
    speedKey: 'ModelSpeedVeryFast',
    qualityKey: 'ModelQualityGood',
    useCaseKey: 'ModelUseCaseModestPcs',
  },
  {
    fileName: 'gemma-4-E2B-it-Q4_K_M.gguf',
    displayName: 'Gemma 4 E2B Instruct',
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf',
    fileSizeGb: 3.11,
    sizeBytes: 3106738272,
    minRamGb: 6,
    speedKey: 'ModelSpeedFast',
    qualityKey: 'ModelQualityVeryGood',
    useCaseKey: 'ModelUseCaseRecommendedDefault',
  },
  {
    fileName: 'gemma-4-E4B-it-Q4_K_M.gguf',
    displayName: 'Gemma 4 E4B Instruct',
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
    fileSizeGb: 4.98,
    sizeBytes: 4977171584,
    minRamGb: 8,
    speedKey: 'ModelSpeedMedium',
    qualityKey: 'ModelQualityExcellent',
    useCaseKey: 'ModelUseCasePc16GbOrGpu',
  },
  {
    fileName: 'gemma-4-12b-it-Q4_K_M.gguf',
    displayName: 'Gemma 4 12B Instruct',
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf',
    fileSizeGb: 7.12,
    sizeBytes: 7121861440,
    minRamGb: 16,
    speedKey: 'ModelSpeedSlowWithoutGpu',
    qualityKey: 'ModelQualityExcellent',
    useCaseKey: 'ModelUseCaseGpuOnly',
  },
];

export const findSummaryModel = (fileName: string | null | undefined): SummaryModelInfo | null =>
  SUMMARY_MODELS.find((model) => model.fileName === fileName) ?? null;

const hasDedicatedGpu = (hardware: HardwareProfile): boolean =>
  hardware.gpuVramGb !== null && hardware.gpuVramGb > 0;

export interface RateOptions {
  /**
   * Whether the llama runtime in use can offload to the GPU. When false (the CPU build) the VRAM
   * cannot stand in for RAM (B17). Defaults to true, the behavior before the runtime choice existed.
   */
  readonly gpuOffload?: boolean;
}

/** Spec 2.4: enough RAM, or a usable GPU holding half of it; else slow from 75 % of the RAM. */
export function rateFor(
  model: SummaryModelInfo,
  hardware: HardwareProfile,
  options: RateOptions = {},
): FitRating {
  const gpuCounts = (options.gpuOffload ?? true) && hasDedicatedGpu(hardware);
  if (
    hardware.totalRamGb >= model.minRamGb ||
    (gpuCounts && (hardware.gpuVramGb ?? 0) >= model.minRamGb / 2)
  ) {
    return 'Recommended';
  }
  if (hardware.totalRamGb >= model.minRamGb * 0.75) return 'MayBeSlow';
  return 'NotRecommended';
}

/**
 * The rating is hardware fit, not a pick: every model can fit a large PC. The labels say so in
 * plain words (settings polish 2026-11-05); the WinUI `Fit_` strings read as recommendations.
 */
export const FIT_LABEL_KEYS: Readonly<Record<FitRating, string>> = {
  Recommended: 'Ui_FitRunsWell',
  MayBeSlow: 'Ui_FitMayBeSlow',
  NotRecommended: 'Ui_FitTooHeavy',
};

/** The size as the .NET `0.#` pattern writes it in the locale: 0.81 gives 0.8, 4.98 gives 5. */
export const formatModelSize = (sizeGb: number, locale: CatalogLocale): string =>
  formatTemplate('{0:0.#}', [sizeGb], locale);
