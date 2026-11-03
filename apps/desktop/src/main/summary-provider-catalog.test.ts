import { describe, expect, it } from 'vitest';
import en from '../renderer/i18n/locales/en.json';
import es from '../renderer/i18n/locales/es.json';
import uiEn from '../renderer/i18n/locales/ui.en.json';
import uiEs from '../renderer/i18n/locales/ui.es.json';

// Parity item 187: every key the summaries module uses (spec 2.9) exists in both languages, and the
// copy added by this port follows the house rules.

const english: Record<string, string> = { ...en, ...uiEn };
const spanish: Record<string, string> = { ...es, ...uiEs };

const SETTINGS_KEYS = [
  'Settings_SummaryProvider.Text',
  'Settings_SummaryProviderCard.Header',
  'Settings_ProviderLocal.Text',
  'Settings_ProviderClaude.Text',
  'Settings_ProviderCodex.Text',
  'Settings_ClaudeOptions.Header',
  'Settings_ClaudeOptions.Description',
  'Settings_ClaudeModel.Header',
  'Settings_ClaudeEffort.Header',
  'Settings_ClaudeEffort.Description',
  'Settings_CodexOptions.Header',
  'Settings_CodexOptions.Description',
  'Settings_CodexModel.Header',
  'Settings_CodexEffort.Header',
  'Settings_CodexEffort.Description',
  'Settings_SummaryModels.Header',
  'Settings_SummaryModels.Description',
  'Settings_Active.Content',
  'Settings_Download.Content',
  'Settings_Delete.Content',
  'Status_CliOnPath',
  'Status_CliMissing',
  // The xAI-named key is reused for the Claude and Codex toast (spec 2.9).
  'Xai_FeedbackModel',
  'Ui_CliCheckAgain',
  'Ui_ModelDownloading',
  'Ui_ModelCancelDownload',
  'Ui_ModelDownloadFailed',
  'Ui_ModelDeleteFailed',
  'Ui_ModelDeleteBusy',
  'Ui_ModelMissing',
  'Ui_SummaryProviderCardDescription',
  'Ui_SummaryProviderXaiRemoved',
  'RecordingSetup_SetUp',
];

const FAMILIES = [
  /^Fit_/,
  /^Model_/,
  /^Hardware_/,
  /^Download_/,
  /^Setup_(?!Xai)/,
  /^Cli_/,
  /^Status_(Generating|Summary|SetupCancelled|DoneWithSummary)/,
  /^NoteTemplate_/,
  /^NotesMode_/,
  /^SummaryPage_/,
  /^SummaryRegenerate_/,
  /^ModelSpeed/,
  /^ModelQuality/,
  /^ModelUseCase/,
  /^CliFailure/,
  /^Ui_Summary/,
];

const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\d+)/g)].map((m) => m[1] ?? '').sort();

describe('summary provider and settings keys (187)', () => {
  it.each(SETTINGS_KEYS)('%s exists in English and Spanish and is not empty', (key) => {
    expect(english[key], `${key} in English`).toBeTruthy();
    expect(spanish[key], `${key} in Spanish`).toBeTruthy();
  });

  it('every key of the module families is in both catalogs, with the same placeholders', () => {
    const keys = new Set(
      [...Object.keys(english), ...Object.keys(spanish)].filter((key) =>
        FAMILIES.some((family) => family.test(key)),
      ),
    );
    expect(keys.size).toBeGreaterThan(60);
    for (const key of keys) {
      expect(english[key], `${key} in English`).toBeTruthy();
      expect(spanish[key], `${key} in Spanish`).toBeTruthy();
      expect(placeholders(spanish[key] ?? ''), `${key} placeholders`).toEqual(
        placeholders(english[key] ?? ''),
      );
    }
  });

  it('the generated and the hand written catalogs each have identical key sets', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    expect(Object.keys(uiEn).sort()).toEqual(Object.keys(uiEs).sort());
  });

  it('copy written for this port is plain sentence case: no em dash, no double space', () => {
    for (const [key, text] of Object.entries({ ...uiEn, ...uiEs })) {
      if (!/^Ui_(Summary|Model|Cli|Xai)/.test(key)) continue;
      expect(text, key).not.toMatch(/[\u2013\u2014]/);
      expect(text, key).not.toMatch(/ {2}/);
      expect(text, key).toBe(text.trim());
      expect(text.charAt(0), key).toBe(text.charAt(0).toUpperCase());
    }
  });

  it('no new copy names the product as an assistant or uses AI wording', () => {
    for (const [key, text] of Object.entries({ ...uiEn, ...uiEs })) {
      if (!/^Ui_(Summary|Model|Cli)/.test(key)) continue;
      expect(text, key).not.toMatch(/\b(AI|IA|assistant|asistente|magic|magia)\b/i);
    }
  });
});
