import {
  SUMMARY_FAILURE_CATALOG_KEYS,
  SUMMARY_MODELS,
  createLookup,
  formatFailure,
  CliToolError,
  SummaryError,
} from '@vozella/core';
import { describe, expect, it } from 'vitest';
import en from '../renderer/i18n/locales/en.json';
import es from '../renderer/i18n/locales/es.json';
import uiEn from '../renderer/i18n/locales/ui.en.json';
import uiEs from '../renderer/i18n/locales/ui.es.json';

const catalogs = { en: { ...en, ...uiEn }, es: { ...es, ...uiEs } } as Record<
  'en' | 'es',
  Record<string, string>
>;
const placeholders = (text: string): string[] =>
  [...text.matchAll(/\{(\d+)/g)].map((m) => m[1] ?? '').sort();

describe('summary failure and model label keys (parity items 72 to 77, 188)', () => {
  const modelKeys = SUMMARY_MODELS.flatMap((m) => [m.speedKey, m.qualityKey, m.useCaseKey]);
  const keys = [...new Set([...SUMMARY_FAILURE_CATALOG_KEYS, ...modelKeys])];

  it('every key exists in both locales, non empty, with the same placeholders', () => {
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      const english = catalogs.en[key];
      const spanish = catalogs.es[key];
      expect(english, `en ${key}`).toBeTruthy();
      expect(spanish, `es ${key}`).toBeTruthy();
      expect(placeholders(spanish ?? ''), key).toEqual(placeholders(english ?? ''));
    }
  });

  it('the six CliFailure keys and the model label keys are the ones the spec names', () => {
    for (const key of [
      'CliFailureNotInstalled',
      'CliFailureNotSignedIn',
      'CliFailureSubscriptionInactive',
      'CliFailureTimedOut',
      'CliFailureEmptyOutput',
      'CliFailureUnknown',
      'ModelSpeedVeryFast',
      'ModelSpeedFast',
      'ModelSpeedMedium',
      'ModelSpeedSlowWithoutGpu',
      'ModelQualityGood',
      'ModelQualityVeryGood',
      'ModelQualityExcellent',
      'ModelUseCaseModestPcs',
      'ModelUseCaseRecommendedDefault',
      'ModelUseCasePc16GbOrGpu',
      'ModelUseCaseGpuOnly',
    ]) {
      expect(catalogs.en[key], `en ${key}`).toBeTruthy();
      expect(catalogs.es[key], `es ${key}`).toBeTruthy();
    }
  });

  it('new copy has no em dash', () => {
    for (const key of Object.keys(uiEn).filter((k) => k.startsWith('Ui_Summary'))) {
      expect(catalogs.en[key]).not.toContain('—');
      expect(catalogs.es[key]).not.toContain('—');
    }
  });

  it('formats a CLI failure and a stable code in each locale (B28)', () => {
    const spanish = createLookup(catalogs, 'es');
    const english = createLookup(catalogs, 'en');
    expect(formatFailure(new CliToolError('Codex', 'TimedOut'), english)).toBe(
      'Codex took too long and was stopped. Try again, or switch engine in Settings.',
    );
    expect(formatFailure(new CliToolError('Codex', 'TimedOut'), spanish)).toContain(
      'tardó demasiado',
    );
    expect(formatFailure(new SummaryError('TranscriptTooLong', [70, 64]), english)).toBe(
      'The transcript is too long for the local summary model (70 parts, limit 64). Use another summary provider.',
    );
    expect(formatFailure(new SummaryError('TranscriptTooLong', [70, 64]), spanish)).toContain(
      '70 partes',
    );
    expect(formatFailure(new SummaryError('Cancelled'), english)).toBe('Cancelled.');
  });
});
