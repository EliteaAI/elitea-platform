import type { EliteaComponents } from '../theme-types';

/** `MuiAppBar` (R-T12). Ported verbatim from `MainTheme.js:322-328`. */
export const MuiAppBar: EliteaComponents['MuiAppBar'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      background: theme.vars.palette.background.eliteaDefault,
    }),
  },
};
