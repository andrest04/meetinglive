import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import uiEn from './locales/ui.en.json';
import uiEs from './locales/ui.es.json';

// Parity item 158: every string of the session page (spec 2.12) exists in English and Spanish with
// the same placeholders. The suggest-title keys are not listed: that feature was dropped by the
// owner decision of 2026-11-03.
const SPEC_KEYS = [
  'SessionPage_Back.AutomationProperties.Name',
  'SessionPage_TabTranscript.Text',
  'SessionPage_TabSummary.Text',
  'SessionPage_Empty.Text',
  'SessionPage_EmptyCta.Content',
  'SessionPage_Rename.AutomationProperties.Name',
  'SessionPage_Rename.ToolTipService.ToolTip',
  'SessionPage_Copy.AutomationProperties.Name',
  'SessionPage_Copy.ToolTipService.ToolTip',
  'SessionPage_OpenLocation.AutomationProperties.Name',
  'SessionPage_OpenLocation.ToolTipService.ToolTip',
  'SessionPage_CopyConfirmation.Title',
  'SessionPage_CopyConfirmation.Message',
  'SessionPage_Retranscribe.AutomationProperties.Name',
  'SessionPage_Retranscribe.ToolTipService.ToolTip',
  'SessionPage_RetranscribeProgress.AutomationProperties.Name',
  'SessionPage_RetranscribeCancel.Content',
  'SessionPage_RetranscribeCancel.AutomationProperties.Name',
  'SessionPage_RetranscribeError.Title',
  'SessionPage_RetranscribeNotice.Title',
  'SessionRetranscribe_Title',
  'SessionRetranscribe_Content',
  'SessionRetranscribe_Primary',
  'SessionRetranscribe_Cancel',
  'SessionRetranscribe_Done',
  'SessionRetranscribe_DoneNoSummary',
  'SessionRetranscribe_Cancelled',
  'SessionRename_Title',
  'SessionRename_Primary',
  'SessionRename_Cancel',
  'SessionRename_Name.Header',
  'SessionRename_Name.PlaceholderText',
  'TranscriptPage_Empty.Text',
  'TranscriptPage_EmptyCta.Content',
  'Status_Transcribing',
  'Status_TranscribingPercent',
  'Dialog_OK',
] as const;

// Strings the port added for states the old app left silent (B9, B13, B16).
const PORT_KEYS = [
  'Ui_SessionPageOpenLocationFailedText',
  'Ui_SessionPageLoadFailedText',
  'Ui_SessionPageRetryContent',
  'Ui_SessionPageTabsLabel',
  'Ui_SessionRenameBlankHint',
  'Ui_RetranscribeBusy',
  'Ui_RetranscribeNeedsEngine',
] as const;

const catalog = (value: unknown): Record<string, string> => value as Record<string, string>;
const placeholders = (text: string): string[] => (text.match(/\{\d+\}/g) ?? []).sort();

describe('session strings (item 158)', () => {
  it.each(SPEC_KEYS)('%s has a non empty English and Spanish value', (key) => {
    expect(catalog(en)[key]?.trim()).toBeTruthy();
    expect(catalog(es)[key]?.trim()).toBeTruthy();
  });

  it.each(SPEC_KEYS)('%s keeps the same placeholders in both languages', (key) => {
    expect(placeholders(catalog(es)[key] ?? '')).toEqual(placeholders(catalog(en)[key] ?? ''));
  });

  it.each(PORT_KEYS)('%s exists in English and Spanish', (key) => {
    expect(catalog(uiEn)[key]?.trim()).toBeTruthy();
    expect(catalog(uiEs)[key]?.trim()).toBeTruthy();
  });

  it('the confirmation names the meeting through its one placeholder', () => {
    expect(placeholders(catalog(en).SessionRetranscribe_Content ?? '')).toEqual(['{0}']);
  });

  it('the port strings have no em dashes', () => {
    for (const key of PORT_KEYS) {
      expect(catalog(uiEn)[key], key).not.toContain('—');
      expect(catalog(uiEs)[key], key).not.toContain('—');
    }
  });
});
