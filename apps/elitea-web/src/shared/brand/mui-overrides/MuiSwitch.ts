import type { EliteaComponents } from '../theme-types';

/**
 * `MuiSwitch` (R-T12). Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/switch/BaseSwitch.jsx`'s
 * `eliteaSwitchVariants`. `Switch` has no typed `variant` prop in MUI 9.2,
 * and this was the app's only switch skin — `styleOverrides.root` replaces
 * the baseline's `variant="elitea"` gate (same reasoning as `MuiCheckbox`).
 */
export const MuiSwitch: EliteaComponents['MuiSwitch'] = {
  styleOverrides: {
    root: ({ theme }) => {
      const { palette } = theme.vars;
      return {
        '& .MuiSwitch-switchBase': {
          color: palette.background.switch.default.off.thumb,
          '&.Mui-checked': {
            color: palette.background.switch.default.on.thumb,
            '& + .MuiSwitch-track': {
              backgroundColor: palette.background.switch.default.on.track,
              opacity: 1,
            },
          },
        },
        '& .MuiSwitch-track': {
          backgroundColor: palette.background.switch.default.off.track,
          opacity: 1,
        },
        '& .MuiSwitch-switchBase.Mui-disabled': {
          color: palette.background.switch.disabled.off.thumb,
          '&.Mui-checked': {
            color: palette.background.switch.disabled.on.thumb,
          },
        },
        '& .MuiSwitch-switchBase.Mui-disabled + .MuiSwitch-track': {
          backgroundColor: palette.background.switch.default.off.track,
          opacity: 1,
        },
        '& .MuiSwitch-switchBase.Mui-disabled.Mui-checked + .MuiSwitch-track': {
          backgroundColor: palette.background.switch.default.on.track,
          opacity: 1,
        },
      };
    },
  },
};
