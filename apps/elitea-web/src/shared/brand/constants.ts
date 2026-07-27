/**
 * The two strings that couple the theme, the DOM and the anti-flash script.
 * They live alone in this module so `index.html` tooling, unit R2's provider
 * and `buildTheme.ts` can all import the same literal instead of repeating
 * it (spec §4.2 notes; context7-verified against MUI 9.2.0).
 */

/** `cssVariables.cssVarPrefix` — every token is `--el-palette-…`. */
export const CSS_VAR_PREFIX = 'el';

/**
 * `cssVariables.colorSchemeSelector`. MUI substitutes `%s` with the scheme
 * name, so the emitted rules are `[data-el-scheme="light"]` and
 * `[data-el-scheme="dark"]` (verified in
 * `@mui/system/cssVars/prepareCssVars.js`: any selector containing `%s` is
 * used as-is with `%s` replaced; the `.`/`[` requirement comes from the two
 * shorthand forms `class`/`data`).
 */
export const COLOR_SCHEME_SELECTOR = '[data-el-scheme="%s"]';

/**
 * The DOM attribute the selector above resolves to, for consumers that need
 * to set it directly (unit R2's scheme toggle, the e2e visual suite).
 *
 * @public Wave-1 surface: consumed by R2's scheme toggle and V2's visual suite.
 */
export const COLOR_SCHEME_ATTRIBUTE = 'data-el-scheme';

/**
 * The baseline's initial scheme: `slices/settings.js:76` reads
 * `localStorage.getItem('mode') || 'dark'`. Dark is therefore the default
 * colour scheme (N4), which also makes `:root` carry the dark variables.
 */
export const DEFAULT_COLOR_SCHEME = 'dark';

/**
 * The anti-flash script (spec §4.2: it goes in `index.html` BEFORE the app
 * bundle). Unit F1 owns `index.html` and unit R2 owns the provider tree, so
 * T1 ships the exact snippet rather than editing either:
 *
 * ```tsx
 * // src/app/providers/… (unit R2), rendered before <App/>:
 * import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
 * import { COLOR_SCHEME_SELECTOR, DEFAULT_COLOR_SCHEME } from '@/shared/brand';
 *
 * <InitColorSchemeScript
 *   attribute={COLOR_SCHEME_SELECTOR}
 *   defaultMode={DEFAULT_COLOR_SCHEME}
 *   modeStorageKey="el-mode"
 * />
 * ```
 *
 * `attribute` MUST equal `colorSchemeSelector` and `defaultMode` MUST equal
 * `defaultColorScheme`, or the script writes an attribute the stylesheet does
 * not match and the flash it exists to prevent happens anyway (MUI 9.2
 * InitColorSchemeScript "Caveats").
 *
 * @public Wave-1 surface: consumed by R2's provider tree.
 */
export const INIT_COLOR_SCHEME_PROPS = {
  attribute: COLOR_SCHEME_SELECTOR,
  defaultMode: DEFAULT_COLOR_SCHEME,
  modeStorageKey: 'el-mode',
} as const;
