import { describe, expect, it } from 'vitest';
import {
  appRestart,
  commitOutcomeSchema,
  eventChannels,
  i18nGetLocale,
  requestChannels,
  settingsModelsDelete,
  settingsModelsDownload,
  settingsSetCliOption,
  settingsSetMeetingLanguage,
  settingsXaiSignIn,
} from './index';

describe('settings contracts', () => {
  it('registers every settings request and event by name', () => {
    for (const name of [
      'settings.getPage',
      'settings.setUiLanguage',
      'settings.setSummaryProvider',
      'settings.setCliOption',
      'settings.setMeetingLanguage',
      'settings.detectCli',
      'settings.dismissNotice',
      'settings.models.download',
      'settings.models.cancel',
      'settings.models.select',
      'settings.models.delete',
      'settings.xai.refresh',
      'settings.xai.saveApiKey',
      'settings.xai.signOut',
      'settings.xai.signIn',
      'i18n.getLocale',
      'app.restart',
    ]) {
      expect(Object.keys(requestChannels)).toContain(name);
    }
    expect(Object.keys(eventChannels)).toEqual(
      expect.arrayContaining(['settings.modelEvent', 'i18n.localeChanged']),
    );
  });

  it('a change answers with a value for saved, ignored and failed', () => {
    expect(commitOutcomeSchema.safeParse({ status: 'ignored', reason: 'unchanged' }).success).toBe(
      true,
    );
    expect(commitOutcomeSchema.safeParse({ status: 'failed', message: 'disk full' }).success).toBe(
      true,
    );
    expect(commitOutcomeSchema.safeParse({ status: 'ignored', reason: 'whatever' }).success).toBe(
      false,
    );
  });

  it('command inputs are bounded and typed', () => {
    expect(
      settingsSetCliOption.input.safeParse({ provider: 'claude', field: 'model', value: 'opus' })
        .success,
    ).toBe(true);
    expect(
      settingsSetCliOption.input.safeParse({ provider: 'gemini', field: 'model', value: 'x' })
        .success,
    ).toBe(false);
    expect(
      settingsSetCliOption.input.safeParse({
        provider: 'xai',
        field: 'model',
        value: 'x'.repeat(301),
      }).success,
    ).toBe(false);
    expect(
      settingsSetMeetingLanguage.input.safeParse({ kind: 'summary', code: 'en' }).success,
    ).toBe(true);
    expect(settingsSetMeetingLanguage.input.safeParse({ kind: 'other', code: 'en' }).success).toBe(
      false,
    );
  });

  it('model downloads and deletes answer with every outcome', () => {
    for (const out of [
      { status: 'done' },
      { status: 'cancelled' },
      { status: 'failed', message: 'HTTP 503' },
      { status: 'ignored', reason: 'already-downloading' },
    ]) {
      expect(settingsModelsDownload.output.safeParse(out).success).toBe(true);
    }
    expect(settingsModelsDelete.output.safeParse({ status: 'busy' }).success).toBe(true);
    expect(settingsModelsDelete.output.safeParse({ status: 'nope' }).success).toBe(false);
  });

  it('the locale and restart answers are closed sets', () => {
    expect(i18nGetLocale.output.safeParse({ tag: 'es', locale: 'es', saved: true }).success).toBe(
      true,
    );
    expect(i18nGetLocale.output.safeParse({ tag: 'fr', locale: 'es', saved: true }).success).toBe(
      false,
    );
    expect(appRestart.output.safeParse({ status: 'refused' }).success).toBe(true);
  });

  it('sign in can say it is unavailable until the xAI module exists', () => {
    expect(settingsXaiSignIn.output.safeParse({ status: 'unavailable' }).success).toBe(true);
  });
});
