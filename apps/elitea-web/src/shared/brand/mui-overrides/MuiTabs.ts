import type { EliteaComponents } from '../theme-types';

/**
 * `MuiTabs` (R-T12). Ported from
 * `apps/elitea-ui/src/[fsd]/shared/ui/tabs/BaseTabs.jsx`'s
 * `MuiTabsStyles`/`baseTabsStyle`.
 */
export const MuiTabs: EliteaComponents['MuiTabs'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      minHeight: '2rem',
      '& .MuiTabs-indicator': {
        backgroundColor: theme.vars.palette.background.tabs.default,
        // Baseline `BaseTabs.jsx:31` is `2rem 2rem 0 0`; on a 2-3px indicator
        // that clamps to a fully rounded top, which `radiusLg` (16px) also
        // does — but only because the indicator is thin. `radiusPill` states
        // the intent so a thicker indicator keeps the shape.
        borderRadius: `${theme.vars.shape.radiusPill} ${theme.vars.shape.radiusPill} 0 0`,
      },
    }),
  },
};
