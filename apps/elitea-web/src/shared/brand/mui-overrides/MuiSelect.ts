import type { EliteaComponents } from '../theme-types';

/**
 * `MuiSelect` (R-T12). Ported from `MainTheme.js:235-242` (the `select`
 * slot colour) plus `select/singleSelectVariants.js`'s
 * `eliteaSingleSelectVariants` (the baseline's only `Select` variant,
 * `'standard'`), which resolves the underline/label state colours `SingleSelect`
 * depends on.
 */
export const MuiSelect: EliteaComponents['MuiSelect'] = {
  styleOverrides: {
    select: ({ theme }) => ({
      color: theme.vars.palette.text.secondary,
    }),
  },
  variants: [
    {
      props: { variant: 'standard' },
      style: ({ theme }) => ({
        '&.MuiInput-underline:before': {
          borderBottom: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
        '&:not(.Mui-error).MuiInput-underline.Mui-focused:after': {
          borderBottom: `0.0625rem solid ${theme.vars.palette.primary.main}`,
        },
        '&:not(.Mui-error).MuiInput-underline.Mui-disabled:before': {
          borderBottom: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
        '&.Mui-error.MuiInput-underline:before, &.Mui-error.MuiInput-underline:after': {
          borderBottom: `0.0625rem solid ${theme.vars.palette.icon.fill.error}`,
        },
        '& .MuiSelect-select': {
          color: theme.vars.palette.text.select.selected.primary,
          // `headingMedium`'s size (`1rem`, same rung of the modular scale
          // as the baseline's bare literal) via member expression — R-T11.
          fontSize: theme.typography.headingMedium.fontSize,
        },
        '& .MuiSelect-select:focus': {
          backgroundColor: 'transparent',
        },
        '& .MuiInput-input.Mui-disabled, &.Mui-disabled .MuiSelect-select': {
          color: theme.vars.palette.text.default,
          WebkitTextFillColor: theme.vars.palette.text.default,
          cursor: 'not-allowed',
        },
        '& fieldset': {
          border: 'none',
          outline: 'none',
        },
      }),
    },
  ],
};
