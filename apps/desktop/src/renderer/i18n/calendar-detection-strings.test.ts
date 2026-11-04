import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import es from './locales/es.json';
import uiEn from './locales/ui.en.json';
import uiEs from './locales/ui.es.json';

// Item 144 (D4): every key the call detection screens use has an English and a Spanish value.
const KEYS = [
  'CallPrompt_Title',
  'CallPrompt_Body',
  'CallPrompt_TakeNotes',
  'Ui_CallDetection',
  'Settings_MeetingPopup.Header',
  'Settings_MeetingPopup.Description',
  'MeetingPrompt_Title.Text',
  'MeetingPrompt_Subtitle.Text',
  'MeetingPrompt_Start.Content',
  'MeetingPrompt_More.AutomationProperties.Name',
  'MeetingPrompt_Dismiss.Text',
  'MeetingPrompt_NeverAgain.Text',
] as const;

const catalog = (value: unknown): Record<string, string> => value as Record<string, string>;
const enAll = { ...catalog(en), ...catalog(uiEn) };
const esAll = { ...catalog(es), ...catalog(uiEs) };

describe('call detection strings (item 144)', () => {
  it.each(KEYS)('%s has a non empty English and Spanish value', (key) => {
    expect(enAll[key]?.trim()).toBeTruthy();
    expect(esAll[key]?.trim()).toBeTruthy();
  });

  it('the Spanish values are translated, not copied', () => {
    for (const key of KEYS) expect(esAll[key], key).not.toBe(enAll[key]);
  });

  it('the new copy has no em dashes', () => {
    for (const key of KEYS) {
      expect(enAll[key], key).not.toContain('—');
      expect(esAll[key], key).not.toContain('—');
    }
  });
});
