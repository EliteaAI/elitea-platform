import type { EliteaComponents } from '../theme-types';

/**
 * `MuiOutlinedInput` (R-T12). Provides background color and border styling
 * for outlined `TextField` variants that the baseline `MuiTextField` override
 * (which only covers `'standard'`) does not address.
 *
 * All colour tokens read from `theme.vars.palette.*` to support white-label
 * branding.  No internal MUI selectors are used — every rule targets the
 * component's own root or well-known state classes (`Mui-focused`, `Mui-error`).
 */
export const MuiOutlinedInput: EliteaComponents['MuiOutlinedInput'] = {
  styleOverrides: {
    root: ({ theme }) => {
      const { palette, shape } = theme.vars;
      return {
        backgroundColor: palette.background.userInputBackground,
        borderRadius: shape.radiusMd,
        fontSize: theme.typography.bodyMedium.fontSize,
        color: palette.text.secondary,
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: palette.border.lines,
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: palette.border.lines,
        },
        '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
          borderColor: palette.primary.main,
          borderWidth: '0.0625rem',
        },
        '&.Mui-error .MuiOutlinedInput-notchedOutline': {
          borderColor: palette.icon.fill.error,
        },
      };
    },
  },
};
