import type { EliteaComponents } from '../theme-types';

/** `MuiAvatar` (R-T12). Ported verbatim from `MainTheme.js:209-216`. */
export const MuiAvatar: EliteaComponents['MuiAvatar'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      background: theme.vars.palette.background.avatar,
      color: theme.vars.palette.text.default,
    }),
  },
};
