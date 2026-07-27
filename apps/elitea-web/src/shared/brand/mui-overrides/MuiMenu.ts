import type { EliteaComponents } from '../theme-types';

/** `MuiMenu` (R-T12). Ported verbatim from `MainTheme.js:243-251` (radiusMd
 * ≈ the baseline's `0.5rem`). */
export const MuiMenu: EliteaComponents['MuiMenu'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      background: theme.vars.palette.background.secondary,
      borderRadius: theme.vars.shape.radiusMd,
      border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
    }),
  },
};
