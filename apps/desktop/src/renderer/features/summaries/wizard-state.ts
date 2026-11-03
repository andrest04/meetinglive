import type { ModelRowDto, SummaryCliKindDto } from '@vozella/contracts';

/** `choose` starts at the engine chooser; `local-only` is for an engine that is already Local. */
export type WizardMode = 'choose' | 'local-only';

export type WizardEngine = 'Local' | SummaryCliKindDto;

export interface HardwareSummaryDto {
  readonly totalRamGb: number;
  readonly gpuName: string | null;
  readonly gpuVramGb: number | null;
}

/** What the wizard hands back when it ends with a ready engine. */
export type WizardResult =
  { readonly kind: 'Local'; readonly fileName: string } | { readonly kind: SummaryCliKindDto };

/**
 * One panel per phase (spec 2.6). `attempt` numbers every request the wizard sends; an answer
 * carries the number it was sent under, and one that no longer matches is stale and dropped.
 */
export type WizardState =
  | { readonly phase: 'ChoosingEngine'; readonly attempt: number }
  | {
      readonly phase: 'DetectingHardware';
      readonly attempt: number;
      readonly error: string | null;
    }
  | {
      readonly phase: 'SelectingModel';
      readonly attempt: number;
      readonly hardware: HardwareSummaryDto | null;
      readonly rows: readonly ModelRowDto[];
      readonly selected: string | null;
      /** True while the choice of an already downloaded file is being saved. */
      readonly busy: boolean;
      /** The last download failure, shown above the list (B7). */
      readonly error: string | null;
    }
  | {
      readonly phase: 'Downloading';
      readonly attempt: number;
      readonly hardware: HardwareSummaryDto | null;
      readonly rows: readonly ModelRowDto[];
      readonly fileName: string;
      readonly percent: number;
    }
  | { readonly phase: 'CheckingCli'; readonly attempt: number; readonly cli: SummaryCliKindDto }
  | { readonly phase: 'Completed'; readonly attempt: number; readonly result: WizardResult }
  | { readonly phase: 'Closed'; readonly attempt: number };

export type WizardAction =
  | { readonly type: 'chooseEngine'; readonly engine: WizardEngine }
  | { readonly type: 'back' }
  | {
      readonly type: 'hardwareLoaded';
      readonly attempt: number;
      readonly hardware: HardwareSummaryDto | null;
      readonly rows: readonly ModelRowDto[];
      readonly defaultFileName: string | null;
    }
  | { readonly type: 'hardwareFailed'; readonly attempt: number; readonly message: string }
  | { readonly type: 'retryHardware' }
  | { readonly type: 'select'; readonly fileName: string }
  | { readonly type: 'startDownload'; readonly fileName: string }
  | { readonly type: 'startSave'; readonly fileName: string }
  | { readonly type: 'progress'; readonly fileName: string; readonly percent: number }
  | { readonly type: 'downloadSaved'; readonly attempt: number; readonly fileName: string }
  | { readonly type: 'downloadFailed'; readonly attempt: number; readonly message: string }
  | { readonly type: 'cancelDownload' }
  /** Main answered `cancelled` to the request sent under this attempt. */
  | { readonly type: 'downloadCancelled'; readonly attempt: number }
  | { readonly type: 'cliReady' }
  | { readonly type: 'close' };

export function initialWizardState(mode: WizardMode): WizardState {
  // Local-only opens on detection itself, so the chooser never shows first (B33).
  return mode === 'local-only'
    ? { phase: 'DetectingHardware', attempt: 1, error: null }
    : { phase: 'ChoosingEngine', attempt: 0 };
}

const clamp = (percent: number): number => Math.min(100, Math.max(0, percent));

/** Pure: every transition of the wizard. An action that does not fit the phase returns the same state. */
export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  if (state.phase === 'Closed' || state.phase === 'Completed') return state;
  if (action.type === 'close') return { phase: 'Closed', attempt: state.attempt + 1 };

  switch (state.phase) {
    case 'ChoosingEngine':
      if (action.type !== 'chooseEngine') return state;
      return action.engine === 'Local'
        ? { phase: 'DetectingHardware', attempt: state.attempt + 1, error: null }
        : { phase: 'CheckingCli', attempt: state.attempt + 1, cli: action.engine };

    case 'CheckingCli':
      if (action.type === 'back') return { phase: 'ChoosingEngine', attempt: state.attempt + 1 };
      if (action.type === 'cliReady') {
        return { phase: 'Completed', attempt: state.attempt + 1, result: { kind: state.cli } };
      }
      return state;

    case 'DetectingHardware':
      if (action.type === 'retryHardware') {
        return { phase: 'DetectingHardware', attempt: state.attempt + 1, error: null };
      }
      if (action.type === 'hardwareFailed' && action.attempt === state.attempt) {
        return { ...state, error: action.message };
      }
      if (action.type === 'hardwareLoaded' && action.attempt === state.attempt) {
        return {
          phase: 'SelectingModel',
          attempt: state.attempt,
          hardware: action.hardware,
          rows: action.rows,
          selected: action.defaultFileName ?? action.rows[0]?.fileName ?? null,
          busy: false,
          error: null,
        };
      }
      return state;

    case 'SelectingModel':
      if (action.type === 'select' && !state.busy) {
        return { ...state, selected: action.fileName, error: null };
      }
      if (action.type === 'startDownload' && !state.busy) {
        return {
          phase: 'Downloading',
          attempt: state.attempt + 1,
          hardware: state.hardware,
          rows: state.rows,
          fileName: action.fileName,
          percent: 0,
        };
      }
      if (action.type === 'startSave' && !state.busy) {
        return { ...state, attempt: state.attempt + 1, busy: true, error: null };
      }
      if (action.type === 'downloadFailed' && state.busy && action.attempt === state.attempt) {
        return { ...state, busy: false, error: action.message };
      }
      if (action.type === 'downloadCancelled' && state.busy && action.attempt === state.attempt) {
        return { ...state, busy: false };
      }
      if (action.type === 'downloadSaved' && state.busy && action.attempt === state.attempt) {
        return {
          phase: 'Completed',
          attempt: state.attempt + 1,
          result: { kind: 'Local', fileName: action.fileName },
        };
      }
      return state;

    case 'Downloading':
      if (action.type === 'progress') {
        if (action.fileName !== state.fileName) return state;
        const percent = clamp(action.percent);
        return percent > state.percent ? { ...state, percent } : state;
      }
      if (
        action.type === 'cancelDownload' ||
        (action.type === 'downloadCancelled' && action.attempt === state.attempt)
      ) {
        // Back to the list at once; whatever main answers for the cancelled run is stale.
        return {
          phase: 'SelectingModel',
          attempt: state.attempt + 1,
          hardware: state.hardware,
          rows: state.rows,
          selected: state.fileName,
          busy: false,
          error: null,
        };
      }
      if (action.type === 'downloadFailed' && action.attempt === state.attempt) {
        return {
          phase: 'SelectingModel',
          attempt: state.attempt + 1,
          hardware: state.hardware,
          rows: state.rows,
          selected: state.fileName,
          busy: false,
          error: action.message,
        };
      }
      if (action.type === 'downloadSaved' && action.attempt === state.attempt) {
        return {
          phase: 'Completed',
          attempt: state.attempt + 1,
          result: { kind: 'Local', fileName: action.fileName },
        };
      }
      return state;
  }
}
