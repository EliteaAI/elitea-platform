import type { EliteaComponents } from '../theme-types';

/**
 * `MuiFormControlLabel` (R-T12). Sets the label text size to match the
 * project context review form's requirement of `bodySmall` — the same size
 * the original inline `sx` override targeted via `.MuiFormControlLabel-label`.
 *
 * All colours read from `theme.vars.palette.*` to support white-label branding.
 */
export const MuiFormControlLabel: EliteaComponents['MuiFormControlLabel'] = {
  styleOverrides: {
    label: ({ theme }) => ({
      fontSize: theme.typography.bodySmall.fontSize,
    }),
  },
};
