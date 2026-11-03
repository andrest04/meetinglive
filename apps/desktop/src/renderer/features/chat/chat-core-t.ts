import type { TranslateFn } from '@vozella/core';
import type { Translate } from '../../i18n/translate';
import type { StringKey } from '../../i18n/translate';

/** The renderer translator typed for the core failure mappers, which take plain string keys. */
export const toCoreT =
  (t: Translate): TranslateFn =>
  (key, ...args) =>
    t(key as StringKey, ...args);
