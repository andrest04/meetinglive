import type { Catalogs } from '@vozella/core';
import en from '../../renderer/i18n/locales/en.json';
import es from '../../renderer/i18n/locales/es.json';
import uiEn from '../../renderer/i18n/locales/ui.en.json';
import uiEs from '../../renderer/i18n/locales/ui.es.json';

/** The same catalogs the renderer loads. The main process reads them with an explicit locale. */
export const mainCatalogs: Catalogs = {
  en: { ...en, ...uiEn },
  es: { ...es, ...uiEs },
};
