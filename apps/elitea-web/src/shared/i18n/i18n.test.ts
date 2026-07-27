import { describe, expect, it, vi } from 'vitest';

import en from './en.json';
import { DEFAULT_LOCALE, DEFAULT_NAMESPACE, i18n, logInitFailure, warnOnMissingKey } from './i18n';

describe('i18n instance', () => {
  it('initializes synchronously from an inline resources object (no backend round-trip)', () => {
    // If init() needed an async backend, isInitialized would still be false
    // right after this synchronous module import — see i18n.ts's header
    // comment for why resources-only init is synchronous.
    expect(i18n.isInitialized).toBe(true);
  });

  it('defaults to the en locale, with en as its own fallback', () => {
    // i18next normalizes a string `fallbackLng` into an array internally
    // (`services.languageUtils`), which is what `i18n.options.fallbackLng`
    // reflects post-init — asserting against that normalized shape rather
    // than the raw string passed to `init()`.
    expect(i18n.language).toBe(DEFAULT_LOCALE);
    expect(i18n.options.fallbackLng).toEqual([DEFAULT_LOCALE]);
  });

  it('loads en.json verbatim as the "translation" namespace bundle', () => {
    expect(i18n.getResourceBundle(DEFAULT_LOCALE, DEFAULT_NAMESPACE)).toEqual(en);
  });

  it('is wired through the react-i18next plugin (initReactI18next), not raw i18next', () => {
    // initReactI18next registers itself as a `type: '3rdParty'` module in
    // `modules.external`: its presence is how react-i18next's
    // I18nextProvider/useTranslation later resolve a "real" React-aware
    // instance instead of a bare i18next core.
    expect(i18n.modules.external.length).toBeGreaterThan(0);
    expect(i18n.modules.external.some((module) => module.type === '3rdParty')).toBe(true);
  });

  it('does not escape interpolated values (React already escapes on render)', () => {
    expect(i18n.options.interpolation?.escapeValue).toBe(false);
  });

  it('reports saveMissing so a missing key is always caught, not just in dev', () => {
    expect(i18n.options.saveMissing).toBe(true);
    expect(typeof i18n.options.missingKeyHandler).toBe('function');
  });

  it('warnOnMissingKey logs a warning naming the key, the namespace, and the fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnOnMissingKey(['en'], DEFAULT_NAMESPACE, 'demo.direct', 'Direct fallback');

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('demo.direct');
    expect(message).toContain(DEFAULT_NAMESPACE);
    expect(message).toContain('Direct fallback');

    warn.mockRestore();
  });

  it('logInitFailure logs init() rejection instead of throwing (defensive path — not exercised by init itself, since a static resources object never rejects)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cause = new Error('simulated init failure');

    expect(() => {
      logInitFailure(cause);
    }).not.toThrow();
    expect(error).toHaveBeenCalledWith('[shared/i18n] i18next.init() rejected', cause);

    error.mockRestore();
  });
});
