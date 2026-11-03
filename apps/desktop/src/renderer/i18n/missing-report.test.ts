// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportMissingOnce } from './I18nProvider';

afterEach(() => {
  Reflect.deleteProperty(window, 'vozella');
});

describe('a missing string', () => {
  it('is reported once per key and locale, naming the fallback', () => {
    const invoke = vi.fn(() => Promise.resolve({}));
    Object.defineProperty(window, 'vozella', { value: { invoke }, configurable: true });
    const report = reportMissingOnce();
    report('Some_Key', 'es', 'en');
    report('Some_Key', 'es', 'en');
    report('Some_Key', 'en', 'key');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenCalledWith(
      'app.reportRendererError',
      expect.objectContaining({ message: 'missing string Some_Key for es, using en' }),
    );
  });
});
