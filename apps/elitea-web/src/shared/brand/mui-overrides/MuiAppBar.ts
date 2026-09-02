import type { EliteaComponents } from '../theme-types';

/**
 * `MuiAppBar` (R-T12). The `background` is `MainTheme.js:322-328` verbatim.
 *
 * The `color` is not in the baseline and is deliberate: MUI's default
 * `color="primary"` rule pairs `primary.main` with `primary.contrastText`,
 * and the baseline only replaced the first half. `background.eliteaDefault`
 * is a neutral surface (a pale gradient in light, the page ground in dark),
 * so its foreground is the scheme's text colour — the pairing MUI itself
 * uses for its neutral `color="default"` bar — and never the white that
 * `contrastText` derives from a saturated light-scheme primary.
 */
export const MuiAppBar: EliteaComponents['MuiAppBar'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      background: theme.vars.palette.background.eliteaDefault,
      color: theme.vars.palette.text.primary,
    }),
  },
};
