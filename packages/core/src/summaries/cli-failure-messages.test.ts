import { describe, expect, it } from 'vitest';
import type { Catalogs } from '../i18n/translator';
import { createLookup } from '../i18n/translator';
import { CliToolError, CLI_FAILURE_KINDS } from './cli-failure';
import {
  CLI_FAILURE_CORE_KEYS,
  CLI_FAILURE_UI_KEYS,
  SUMMARY_ERROR_CODES,
  SUMMARY_ERROR_KEYS,
  SummaryError,
  formatFailure,
} from './cli-failure-messages';

const catalogs: Catalogs = {
  en: {
    Error_CliNotInstalled: '{0} is not installed.',
    Error_CliNotSignedIn: 'Your {0} session expired.',
    Error_CliSubscriptionInactive: '{0} subscription.',
    Error_CliTimedOut: '{0} took too long.',
    Error_CliEmptyOutput: '{0} returned nothing.',
    Error_CliUnknown: '{0} could not finish the summary.',
    Ui_SummaryTranscriptTooLong: 'Too long ({0} parts, limit {1}).',
    Ui_SummaryLocalEmpty: 'Local empty.',
    Status_ProcessingCancelled: 'Cancelled.',
  },
  es: {
    Error_CliNotInstalled: '{0} no está instalado.',
    Error_CliUnknown: '{0} no pudo terminar el resumen.',
    Ui_SummaryLocalEmpty: 'Local vacío.',
  },
};

describe('formatFailure', () => {
  const en = createLookup(catalogs, 'en');
  const es = createLookup(catalogs, 'es');

  it.each(CLI_FAILURE_KINDS.filter((kind) => kind !== 'Unknown'))(
    'maps %s to its Error_Cli key without the exit code',
    (kind) => {
      const text = formatFailure(new CliToolError('Codex', kind), en);
      expect(text).toContain('Codex');
      expect(text).not.toMatch(/\b1\b/);
    },
  );

  it('uses the text of the active locale', () => {
    const error = new CliToolError('Codex', 'NotInstalled');
    expect(formatFailure(error, en)).toBe('Codex is not installed.');
    expect(formatFailure(error, es)).toBe('Codex no está instalado.');
  });

  it('appends the sanitized detail for Unknown', () => {
    const error = CliToolError.fromProcess('Claude Code', 9, '', 'odd token=abc failure');
    expect(formatFailure(error, en)).toBe(
      'Claude Code could not finish the summary. odd [redacted] failure',
    );
  });

  it('shows Unknown without detail when there is none', () => {
    expect(formatFailure(new CliToolError('Codex', 'Unknown'), en)).toBe(
      'Codex could not finish the summary.',
    );
  });

  it('formats a stable code with its arguments (B28)', () => {
    expect(formatFailure(new SummaryError('TranscriptTooLong', [70, 64]), en)).toBe(
      'Too long (70 parts, limit 64).',
    );
    expect(formatFailure(new SummaryError('LocalEmpty'), es)).toBe('Local vacío.');
    expect(formatFailure(new SummaryError('Cancelled'), en)).toBe('Cancelled.');
  });

  it('carries a code and args, not English text, in the error', () => {
    const error = new SummaryError('NotesTooLong');
    expect(error.code).toBe('NotesTooLong');
    expect(error.args).toEqual([]);
    expect(error.message).toBe('summary error: NotesTooLong');
  });

  it('returns the message of any other error unchanged', () => {
    expect(formatFailure(new Error('network down'), en)).toBe('network down');
    expect(formatFailure('plain', en)).toBe('plain');
  });
});

describe('key maps', () => {
  it('cover every kind and every code', () => {
    expect(Object.keys(CLI_FAILURE_UI_KEYS).sort()).toEqual([...CLI_FAILURE_KINDS].sort());
    expect(Object.keys(CLI_FAILURE_CORE_KEYS).sort()).toEqual([...CLI_FAILURE_KINDS].sort());
    expect(Object.keys(SUMMARY_ERROR_KEYS).sort()).toEqual([...SUMMARY_ERROR_CODES].sort());
  });
});
