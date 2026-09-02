import { type ReactNode, useMemo } from 'react';

import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';

import {
  type BrandPack,
  DEFAULT_BRAND_PACK,
  DEFAULT_COLOR_SCHEME,
  INIT_COLOR_SCHEME_PROPS,
  buildEliteaTheme,
} from '@/shared/brand';

import { BrandDocumentHead } from './BrandDocumentHead';

export interface BrandThemeProviderProps {
  children: ReactNode;
  /**
   * The resolved brand pack. Channel C (`GET /api/v2/branding/bootstrap.js`,
   * unit W3) is now wired: `AppProviders` passes
   * `shared/brand/channelC.ts`'s `resolveBrandPack()`, which validates
   * `window.elitea_brand` and falls back to the compiled-in
   * `DEFAULT_BRAND_PACK` (channel A) when no valid pack was served. Until
   * that wiring landed this prop had no caller at all and the default below
   * always won, so nothing about the running app was pack-driven (issue #136
   * C). The default is retained for tests and stories that render the
   * provider standalone.
   */
  pack?: BrandPack;
}

/**
 * Tier 2 theme wiring (spec §4.2; §9.3 unit R2 task 2).
 *
 * `modeStorageKey` is passed to `ThemeProvider` explicitly and set to the
 * SAME `'el-mode'` key the static first-paint script reads (`index.html`
 * inline; `entries/admin/public/assets/scheme-init.js` for the admin entry).
 * `ThemeProvider`'s own default (`mui-mode`) does not match that script, and
 * if the two disagreed the runtime provider would read/write a different
 * localStorage key than the one the anti-flash script consulted before it
 * mounted — silently reintroducing the flash on every subsequent visit.
 *
 * MUI's `<InitColorSchemeScript>` used to be rendered here as well. It was
 * VERIFIED — by rendering it under `@testing-library/react` and inspecting
 * the DOM — to emit NO `<script>` element at all for this app: the component
 * renders its script only while `useSyncExternalStore` reports "server
 * render or matching hydration render", which is never true under
 * `createRoot` (spec N6 bans SSR/hydration for this app). It has been removed
 * (ADR-0024 WP3) in favour of the static script, which is the one real
 * anti-flash mechanism this bootstrap can have. `BrandThemeProvider.test.tsx`
 * pins that no runtime script carrying `el-mode` is emitted, so the static
 * one stays the single source.
 *
 * `BrandDocumentHead` carries the `<head>` half of the pack: `@font-face`
 * rules from `typography.fontFaces` and the custom favicon.
 */
export function BrandThemeProvider({ children, pack = DEFAULT_BRAND_PACK }: BrandThemeProviderProps) {
  const theme = useMemo(() => buildEliteaTheme(pack), [pack]);

  return (
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
      modeStorageKey={INIT_COLOR_SCHEME_PROPS.modeStorageKey}
    >
      <CssBaseline enableColorScheme />
      <BrandDocumentHead pack={pack} />
      {children}
    </ThemeProvider>
  );
}
