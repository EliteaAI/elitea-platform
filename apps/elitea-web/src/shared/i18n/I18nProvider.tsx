/**
 * Binds React context to the configured instance in `./i18n.ts`, via
 * react-i18next's real `I18nextProvider` (spec §9.3 unit S8; R2 composes
 * this into the app-wide provider tree alongside MUI/query/brand/the error
 * boundary — §3.2 `app/` is composition-root-only, so the provider lives
 * here and R2 only imports it).
 *
 * `t()` (`./t.ts`) does not need this provider — it reads the same
 * singleton instance directly and works with or without a React tree. This
 * component exists for descendants that call react-i18next's own
 * `useTranslation()` / `<Trans>` directly (e.g. a future language
 * switcher), so they resolve the instance from context instead of the
 * global singleton fallback.
 */
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { i18n } from './i18n';

export function I18nProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
