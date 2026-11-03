import { formatTemplate, type CatalogLocale } from '../i18n/format';

/** What the machine can run. From the hardware probe (spec contract `HardwareProfile`). */
export interface HardwareProfile {
  readonly totalRamGb: number;
  readonly gpuName: string | null;
  readonly gpuVramGb: number | null;
}

export type FitRating = 'Recommended' | 'MayBeSlow' | 'NotRecommended';

export interface SummaryModelInfo {
  /** The persisted id and the file name on disk. */
  readonly fileName: string;
  readonly displayName: string;
  readonly downloadUrl: string;
  readonly fileSizeGb: number;
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

/** Spec 2.4: enough RAM, or a GPU holding half of it; else slow from 75 % of the RAM. */
export function rateFor(model: SummaryModelInfo, hardware: HardwareProfile): FitRating {
  if (
    hardware.totalRamGb >= model.minRamGb ||
    (hasDedicatedGpu(hardware) && (hardware.gpuVramGb ?? 0) >= model.minRamGb / 2)
  ) {
    return 'Recommended';
  }
  if (hardware.totalRamGb >= model.minRamGb * 0.75) return 'MayBeSlow';
  return 'NotRecommended';
}

export const FIT_LABEL_KEYS: Readonly<Record<FitRating, string>> = {
  Recommended: 'Fit_Recommended',
  MayBeSlow: 'Fit_MayBeSlow',
  NotRecommended: 'Fit_NotRecommended',
};

/** The size as the .NET `0.#` pattern writes it in the locale: 0.81 gives 0.8, 4.98 gives 5. */
export const formatModelSize = (sizeGb: number, locale: CatalogLocale): string =>
  formatTemplate('{0:0.#}', [sizeGb], locale);
