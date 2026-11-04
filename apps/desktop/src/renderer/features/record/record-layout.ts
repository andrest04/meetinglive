import type { StringKey } from '../../i18n/translate';

/**
 * The derived view flags of the Record page (spec 2.1). Nothing here is stored: the page computes
 * them from main's state on every render.
 */

export interface RecordLayoutInput {
  readonly isRecording: boolean;
  readonly isProcessing: boolean;
  readonly isReadyToRecord: boolean;
  /** The canvas has text to show: the live text during a session, the saved one after it. */
  readonly hasCanvasTranscript: boolean;
}

export interface RecordLayoutFlags {
  readonly isSessionActive: boolean;
  readonly showSetupPanel: boolean;
  readonly showRecordHero: boolean;
  readonly showImportAudio: boolean;
  readonly showTranscriptCanvas: boolean;
  readonly canvasHeadingKey: StringKey;
}

export function deriveRecordLayout(input: RecordLayoutInput): RecordLayoutFlags {
  const isSessionActive = input.isRecording || input.isProcessing;
  const showSetupPanel = !input.isRecording && !input.isProcessing && !input.isReadyToRecord;
  const showRecordHero = !showSetupPanel;
  return {
    isSessionActive,
    showSetupPanel,
    showRecordHero,
    showImportAudio: showRecordHero && !input.isRecording && !input.isProcessing,
    showTranscriptCanvas: isSessionActive || input.hasCanvasTranscript,
    canvasHeadingKey: isSessionActive
      ? 'RecordPage_LiveTranscript.Text'
      : 'RecordPage_SavedTranscript',
  };
}

/** The window width from which the side panel is a right column (spec 2.1). */
export const SIDE_PANEL_MIN_WIDTH = 1100;
export const SIDE_PANEL_WIDTH = 320;
export const STACKED_NOTES_MAX_HEIGHT = 200;

export interface PanelArrangement {
  readonly sideBySide: boolean;
  /** Pixel cap of the notes box when the panels are stacked; null when they sit side by side. */
  readonly notesMaxHeight: number | null;
}

export function arrangePanels(windowWidth: number): PanelArrangement {
  const sideBySide = windowWidth >= SIDE_PANEL_MIN_WIDTH;
  return { sideBySide, notesMaxHeight: sideBySide ? null : STACKED_NOTES_MAX_HEIGHT };
}

export interface StatusMessage {
  readonly key: string;
  readonly args: readonly string[];
  readonly severity: 'info' | 'warning' | 'error';
}

/**
 * The error bars follow the typed severity main sends (B-12), never the first letters of the text.
 */
export const hasStatusError = (messages: readonly StatusMessage[]): boolean =>
  messages.some((message) => message.severity === 'error');

/** Says only what the setup panel shows by being there, so the page does not say it twice. */
const SETUP_REPEAT_KEY = 'Status_NeedsSetup';

/** Says only what an enabled Record button shows by being there. */
const READY_REPEAT_KEY = 'Status_ReadyToRecord';

/** The idle status to draw. Everything else stays: errors, warnings and notices are never dropped. */
export const withoutIdleRepeats = (
  messages: readonly StatusMessage[],
  showSetupPanel: boolean,
): readonly StatusMessage[] =>
  messages.filter(
    (message) =>
      message.severity !== 'info' ||
      (message.key !== READY_REPEAT_KEY && !(showSetupPanel && message.key === SETUP_REPEAT_KEY)),
  );
