import type { Components, Theme } from '@mui/material/styles';

/**
 * The theme shape a `styleOverrides` / `variants` callback receives.
 *
 * `theme.augment.d.ts` sets `CssThemeVariables { enabled: true }`, which is
 * MUI's own switch for "this app always builds themes with `cssVariables`":
 * it promotes `vars`, `colorSchemes` and `cssVarPrefix` from optional to
 * required on `Theme`. Without it, every `theme.vars.…` read in an override
 * would need a non-null assertion — an assertion per token, which is noise
 * and a lie waiting to become true.
 *
 * `Omit<'components'>` mirrors how MUI types `ThemeOptions['components']`:
 * the component map is not visible to the callbacks inside it.
 *
 * @public Wave-1 surface: unit S1 types the remaining ~28 override files with it.
 */
export type EliteaOverrideTheme = Omit<Theme, 'components'>;

/** `Components` bound to the CSS-variable theme. One file per key uses this. */
export type EliteaComponents = Components<EliteaOverrideTheme>;
