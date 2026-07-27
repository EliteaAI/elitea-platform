import type { EliteaComponents } from '../theme-types';

/**
 * `MuiRadio` (R-T12). Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/checkbox/BaseCheckbox.jsx`'s
 * `eliteaUnifiedRadioVariants`. `Radio` has no typed `variant` prop in MUI
 * 9.2, and this was the app's only radio skin — `styleOverrides.root`
 * replaces the baseline's `variant="elitea"` gate (same reasoning as
 * `MuiCheckbox`).
 */
export const MuiRadio: EliteaComponents['MuiRadio'] = {
  styleOverrides: {
    root: ({ theme }) => {
      const { palette } = theme.vars;
      return {
        color: palette.radio.default,
        '&.Mui-checked': {
          color: palette.radio.active,
        },
        '&:hover:not(.Mui-disabled)': {
          backgroundColor: 'transparent',
          color: palette.radio.hover.off,
        },
        '&.Mui-disabled': {
          color: palette.radio.disabled,
          '&.Mui-checked': {
            color: palette.radio.disabled,
          },
        },
        '& .MuiSvgIcon-root': {
          width: '1.25rem',
          height: '1.25rem',
        },
      };
    },
  },
};
