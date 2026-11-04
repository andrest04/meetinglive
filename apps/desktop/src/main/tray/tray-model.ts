export type TrayActionId = 'open' | 'quit';

export interface TrayModel {
  /** The hover text: the product name, or the recording state. */
  readonly tooltip: string;
  readonly items: readonly { readonly id: TrayActionId; readonly label: string }[];
}

/** Catalog keys. The open label reuses the existing "Open Vozella" string. */
export const TRAY_KEYS = {
  open: 'LiveCopilot_OpenApp.ToolTipService.ToolTip',
  quit: 'Ui_TrayQuit',
  recording: 'Ui_TrayRecording',
} as const;

/** The tray menu and tooltip, as plain data so the rule is testable without Electron. */
export function buildTrayModel(input: {
  readonly isRecording: boolean;
  readonly t: (key: string) => string;
}): TrayModel {
  return {
    tooltip: input.isRecording ? input.t(TRAY_KEYS.recording) : 'Vozella',
    items: [
      { id: 'open', label: input.t(TRAY_KEYS.open) },
      { id: 'quit', label: input.t(TRAY_KEYS.quit) },
    ],
  };
}
