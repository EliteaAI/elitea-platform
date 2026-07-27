import type { EliteaComponents } from '../theme-types';

/**
 * `MuiInput` (R-T12). Ported from `input/textFieldVariants.js`'s
 * `eliteaInputVariants` — colours the raw `<input>` from `text.secondary`.
 * `Input`'s `variant` is a single fixed literal (`'standard'`) with no
 * `PropsVariantOverrides` mechanism, so `styleOverrides.root` (applies
 * unconditionally) is the direct equivalent of the baseline's one-entry
 * `variants` array.
 */
export const MuiInput: EliteaComponents['MuiInput'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      '& input': {
        color: theme.vars.palette.text.secondary,
      },
    }),
  },
};
