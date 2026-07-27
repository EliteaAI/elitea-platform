import type { EliteaComponents } from '../theme-types';

/** `MuiPaper` (R-T12). Ported verbatim from `MainTheme.js:228-234`. */
export const MuiPaper: EliteaComponents['MuiPaper'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      background: theme.vars.palette.background.eliteaDefault,
    }),
  },
};
