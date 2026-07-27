import type { EliteaComponents } from '../theme-types';

/**
 * `MuiFormControl` (R-T12). Ported verbatim from `MainTheme.js:170-178`: an
 * error state must not additionally draw a browser/UA box-shadow.
 */
export const MuiFormControl: EliteaComponents['MuiFormControl'] = {
  styleOverrides: {
    root: {
      '&.Mui-error': {
        boxShadow: 'none',
      },
    },
  },
};
