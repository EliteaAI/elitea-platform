import { describe, expect, it } from 'vitest';

import { I18nProvider, i18n, t } from './index';

/**
 * The exact surface R2 imports: `import { t, I18nProvider, i18n } from
 * '@/shared/i18n'`. This test only proves the barrel wires to the same
 * live objects `t.test.ts` / `i18n.test.ts` / `I18nProvider.test.tsx`
 * already exercise in depth — it is not a second copy of those tests.
 */
describe('public API barrel', () => {
  it('exports a working t()', () => {
    expect(t('demo.barrel', 'Barrel fallback')).toBe('Barrel fallback');
  });

  it('exports the I18nProvider component', () => {
    expect(typeof I18nProvider).toBe('function');
  });

  it('exports the live i18next instance', () => {
    expect(i18n.language).toBe('en');
  });
});
