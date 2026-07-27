import type { EliteaComponents } from '../theme-types';

/** `MuiAutocomplete` (R-T12). Ported verbatim from `MainTheme.js:354-363`
 * (radiusMd ≈ the baseline's `0.5rem`). */
export const MuiAutocomplete: EliteaComponents['MuiAutocomplete'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      backgroundColor: theme.vars.palette.background.secondary,
      border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
      borderRadius: theme.vars.shape.radiusMd,
      boxShadow: theme.vars.palette.boxShadow.tagEditorPaper,
    }),
  },
};
