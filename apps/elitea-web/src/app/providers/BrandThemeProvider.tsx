import { type ReactNode, useMemo } from 'react';

import CssBaseline from '@mui/material/CssBaseline';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { ThemeProvider } from '@mui/material/styles';

import {
  type BrandPack,
  DEFAULT_BRAND_PACK,
  DEFAULT_COLOR_SCHEME,
  INIT_COLOR_SCHEME_PROPS,
  buildEliteaTheme,
} from '@/shared/brand';

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
 * `InitColorSchemeScript` is rendered here as a REAL React component (its
 * documented, context7-verified — via the installed
 * `@mui/material@9.2.0`/`InitColorSchemeScript.d.ts` source, since context7
 * itself hit its monthly quota this pass — public API), per unit T1's own
 * instruction left in `shared/brand/constants.ts` (search that file for
 * "unit R2"). `attribute`/`defaultMode`/`modeStorageKey` come straight from
 * T1's `INIT_COLOR_SCHEME_PROPS`, so this component cannot drift out of sync
 * with `buildEliteaTheme`'s `colorSchemeSelector`/`defaultColorScheme` — the
 * exact mismatch MUI 9.2's own docs call out as the caveat that reintroduces
 * the flash the script exists to prevent.
 *
 * `modeStorageKey` is passed to `ThemeProvider` too, explicitly, and set to
 * the SAME `'el-mode'` key: `ThemeProvider`'s own default
 * (`mui-mode`, `InitColorSchemeScript/InitColorSchemeScript.d.ts`'s
 * `defaultConfig`) does not match T1's script config, and if the two
 * disagreed the runtime provider would read/write a different localStorage
 * key than the anti-flash script wrote before it mounted — silently
 * reintroducing the flash on every subsequent visit.
 *
 * A REAL, FLAGGED GAP, STRONGER than originally expected (see this unit's
 * final report) — VERIFIED, not guessed, by rendering this exact component
 * under `@testing-library/react` and inspecting the DOM:
 * `<InitColorSchemeScript>` NEVER EMITS A `<script>` ELEMENT AT ALL for this
 * app's bootstrap. Root cause, read from the installed
 * `@mui/system/InitColorSchemeScript/InitColorSchemeScript.js` source: the
 * component renders its script only while
 * `useSyncExternalStore(subscribe, () => false, () => true)` reports "server
 * render or the matching hydration render" — true during SSR and during a
 * `hydrateRoot` pass that has not yet reconciled, false on every plain
 * client render. `src/app/main.tsx` calls `createRoot(container).render(…)`
 * (never `hydrateRoot`), and spec N6 permanently bans SSR/hydration for this
 * app — so `useIsServerRender()` is `false` from this component's very first
 * commit onward, and it returns `null` every single time. This is not a
 * timing/flash-window nuance; the element is not produced at all.
 *
 * It is still rendered below rather than removed, for three reasons: (1) it
 * is exactly unit T1's documented instruction and costs nothing (a `null`
 * render); (2) it is harmless, self-documenting living intent at the exact
 * spot a real anti-flash mechanism would plug in; (3) IF this app's
 * bootstrap ever adopted `hydrateRoot` against server/pre-rendered markup —
 * which N6 rules out today — this line would activate with no other change.
 * Given N6, genuine first-paint anti-flash protection for THIS app has
 * exactly one real implementation: a static `<script>` in `index.html`
 * (unit F1's file, per spec §4.2's literal instruction) executing before the
 * bundle loads. That edit is NOT made by this unit — it is out of this
 * unit's ownership — and is called out explicitly in the final report
 * instead of being silently worked around.
 */
export function BrandThemeProvider({ children, pack = DEFAULT_BRAND_PACK }: BrandThemeProviderProps) {
  const theme = useMemo(() => buildEliteaTheme(pack), [pack]);

  return (
    <>
      <InitColorSchemeScript {...INIT_COLOR_SCHEME_PROPS} />
      <ThemeProvider
        theme={theme}
        defaultMode={DEFAULT_COLOR_SCHEME}
        modeStorageKey={INIT_COLOR_SCHEME_PROPS.modeStorageKey}
      >
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </>
  );
}
