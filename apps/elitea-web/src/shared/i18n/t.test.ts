import { afterEach, describe, expect, it, vi } from 'vitest';

import en from './en.json';
import { i18n } from './i18n';
import { t } from './t';

/**
 * `t()` is the only piece of this shim call sites ever touch directly.
 * These tests exercise the real, configured singleton (`./i18n.ts`) — no
 * mocking of i18next itself, per §6.2's "mocks stop at the network
 * boundary" (i18next holds no network boundary; it's in-process state, so
 * exercising the real instance IS the unit boundary here).
 */
describe('t()', () => {
  afterEach(() => {
    // Reset to the shipped (currently empty) en.json bundle between tests so
    // a key seeded by one test cannot leak into the next.
    i18n.removeResourceBundle('en', 'translation');
    i18n.addResourceBundle('en', 'translation', en, true, true);
  });

  it('RED: a key absent from the bundle renders the fallback and surfaces a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = t('demo.doesNotExist', 'Fallback copy');

    expect(result).toBe('Fallback copy');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('demo.doesNotExist');
    expect(String(warn.mock.calls[0]?.[0])).toContain('en.json');

    warn.mockRestore();
  });

  it('GREEN: a key present in the bundle wins over the fallback, with no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    i18n.addResourceBundle('en', 'translation', { 'demo.greeting': 'Hello from the bundle' }, true, true);

    const result = t('demo.greeting', 'Hello from the fallback');

    expect(result).toBe('Hello from the bundle');
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('passes count through to i18next pluralization (_one/_other)', () => {
    i18n.addResourceBundle(
      'en',
      'translation',
      { 'demo.count_one': '{{count}} item', 'demo.count_other': '{{count}} items' },
      true,
      true,
    );

    expect(t('demo.count', '{{count}} items', { count: 1 })).toBe('1 item');
    expect(t('demo.count', '{{count}} items', { count: 5 })).toBe('5 items');
  });

  it('interpolates variables into the fallback itself when the key is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(t('demo.missingWithVar', 'Hello {{name}}', { name: 'Ada' })).toBe('Hello Ada');

    warn.mockRestore();
  });

  it('never returns the bare key, even when both the bundle and options are empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(t('demo.anything', 'Always this')).toBe('Always this');
    expect(t('demo.anything', 'Always this')).not.toBe('demo.anything');

    warn.mockRestore();
  });
});
