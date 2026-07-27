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
        borderRadius: `${theme.vars.shape.radiusLg} ${theme.vars.shape.radiusLg} 0 0`,
      },
    }),
  },
};
