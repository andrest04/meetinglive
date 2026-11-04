import { describe, expect, it } from 'vitest';
import {
  arrangePanels,
  deriveRecordLayout,
  hasStatusError,
  withoutSetupRepeat,
} from './record-layout';

const base = {
  isRecording: false,
  isProcessing: false,
  isReadyToRecord: true,
  hasCanvasTranscript: false,
};

describe('deriveRecordLayout (spec 2.1)', () => {
  it('idle and ready shows the hero and Import, no setup panel, no canvas', () => {
    expect(deriveRecordLayout(base)).toEqual({
      isSessionActive: false,
      showSetupPanel: false,
      showRecordHero: true,
      showImportAudio: true,
      showTranscriptCanvas: false,
      canvasHeadingKey: 'RecordPage_SavedTranscript',
    });
  });

  it('idle and not ready swaps the hero for the setup panel and hides Import', () => {
    const flags = deriveRecordLayout({ ...base, isReadyToRecord: false });
    expect(flags.showSetupPanel).toBe(true);
    expect(flags.showRecordHero).toBe(false);
    expect(flags.showImportAudio).toBe(false);
  });

  it.each([{ isRecording: true }, { isProcessing: true }])(
    'a session (%j) never shows the setup panel, even when not ready',
    (session) => {
      const flags = deriveRecordLayout({ ...base, isReadyToRecord: false, ...session });
      expect(flags.isSessionActive).toBe(true);
      expect(flags.showSetupPanel).toBe(false);
      expect(flags.showRecordHero).toBe(true);
      expect(flags.showImportAudio).toBe(false);
      expect(flags.showTranscriptCanvas).toBe(true);
      expect(flags.canvasHeadingKey).toBe('RecordPage_LiveTranscript.Text');
    },
  );

  it('keeps the canvas up after the session while a saved transcript exists', () => {
    const flags = deriveRecordLayout({ ...base, hasCanvasTranscript: true });
    expect(flags.showTranscriptCanvas).toBe(true);
    expect(flags.canvasHeadingKey).toBe('RecordPage_SavedTranscript');
  });
});

describe('arrangePanels (spec 2.1, item 191)', () => {
  it('puts the side panel in a right column from 1100 wide', () => {
    expect(arrangePanels(1100)).toEqual({ sideBySide: true, notesMaxHeight: null });
    expect(arrangePanels(1920).sideBySide).toBe(true);
  });
  it('stacks below 1100 and caps the notes at 200', () => {
    expect(arrangePanels(1099)).toEqual({ sideBySide: false, notesMaxHeight: 200 });
  });
});

describe('status errors (B-12, item 98)', () => {
  const info = { key: 'Status_Transcribing', args: [], severity: 'info' as const };
  const error = { key: 'Error_StopRecording', args: ['x'], severity: 'error' as const };
  it('decides by the typed severity, not by the text', () => {
    expect(hasStatusError([info])).toBe(false);
    expect(hasStatusError([{ ...info, key: 'Error looking text' }])).toBe(false);
    expect(hasStatusError([info, error])).toBe(true);
  });
});

describe('withoutSetupRepeat', () => {
  const needs = { key: 'Status_NeedsSetup', args: [], severity: 'info' as const };
  const warning = { key: 'Warning_MicrophoneLost', args: [], severity: 'warning' as const };
  const cancelled = { key: 'Status_SetupCancelled', args: [], severity: 'info' as const };

  it('drops only the line that says what the setup panel already shows', () => {
    expect(withoutSetupRepeat([needs], true)).toEqual([]);
    expect(withoutSetupRepeat([needs, warning, cancelled], true)).toEqual([warning, cancelled]);
  });

  it('keeps the line when no setup panel is drawn', () => {
    expect(withoutSetupRepeat([needs], false)).toEqual([needs]);
  });

  it('keeps the line if main ever raises it above info', () => {
    const raised = { ...needs, severity: 'error' as const };
    expect(withoutSetupRepeat([raised], true)).toEqual([raised]);
  });
});
