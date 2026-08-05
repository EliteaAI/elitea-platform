import type { EliteaComponents } from '../theme-types';

/**
 * `MuiDialog` (R-T12). Ported from `MainTheme.js:145-155` (radiusLg ≈ the
 * baseline's `1rem`). The baseline's box-shadow was a raw `#FFFFFF0D`
 * literal; `boxShadow.default` is the token role used everywhere else a
 * baseline literal shadow like this one appears (R-T1).
 */
export const MuiDialog: EliteaComponents['MuiDialog'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      background: theme.vars.palette.background.secondary,
      borderRadius: theme.vars.shape.radiusLg,
      border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
      boxShadow: theme.vars.palette.boxShadow.default,
      minWidth: 400,
    }),
  },
};
