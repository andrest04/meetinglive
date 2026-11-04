import { readSettings } from '@vozella/core';
import { describe, expect, it, vi } from 'vitest';
import { mainCatalogs } from './main-catalogs';
import { LocaleState, resolveStartupLanguage } from './locale-state';

const withLanguage = (uiLanguage: string | null) => () =>
  Promise.resolve({ ...readSettings({}), uiLanguage });

describe('resolveStartupLanguage (items 2 to 5)', () => {
  it('3: a settings file that cannot be read is reported and the OS language is used', async () => {
    const onError = vi.fn();
    const result = await resolveStartupLanguage(
      () => Promise.reject(new Error('EACCES')),
      ['es-ES'],
      onError,
    );
    expect(result).toEqual({ tag: 'es', saved: false });
    expect(onError).toHaveBeenCalledOnce();
  });

  it('3: a blank or whitespace language is not a choice', async () => {
    expect(await resolveStartupLanguage(withLanguage(''), ['es-MX'])).toEqual({
      tag: 'es',
      saved: false,
    });
    expect(await resolveStartupLanguage(withLanguage('   '), ['es-MX'])).toEqual({
      tag: 'es',
      saved: false,
    });
    expect(await resolveStartupLanguage(withLanguage(null), [])).toEqual({
      tag: 'en-US',
      saved: false,
    });
  });

  it('4: a saved language wins over the OS on every launch', async () => {
    for (let launch = 0; launch < 3; launch += 1) {
      expect(await resolveStartupLanguage(withLanguage('es'), ['en-US'])).toEqual({
        tag: 'es',
        saved: true,
      });
    }
  });

  it('5: a regional or underscored tag resolves to the shipped language', async () => {
    expect(await resolveStartupLanguage(withLanguage('es_ES'), ['en-US'])).toMatchObject({
      tag: 'es',
    });
  });

  it('5: an unknown saved tag changes nothing and the app stays in English', async () => {
    const result = await resolveStartupLanguage(withLanguage('xx'), ['es-MX']);
    expect(result.tag).toBe('en-US');
    expect((await resolveStartupLanguage(withLanguage('xx'), ['fr-FR'])).tag).toBe('en-US');
  });
});

describe('LocaleState', () => {
  it('looks strings up in the language it holds, and switches after a saved choice', () => {
    const state = new LocaleState({ tag: 'en-US', saved: false }, mainCatalogs);
    const english = state.t('AppClose_Saving_Title');
    state.set('es');
    expect(state.tag).toBe('es');
    expect(state.saved).toBe(true);
    expect(state.t('AppClose_Saving_Title')).not.toBe(english);
  });

  it('reports a missing key instead of throwing', () => {
    const onMissing = vi.fn();
    const state = new LocaleState({ tag: 'es', saved: true }, mainCatalogs, onMissing);
    expect(state.t('No_Such_Key_For_Test')).toBeTypeOf('string');
    expect(onMissing).toHaveBeenCalled();
  });
});
