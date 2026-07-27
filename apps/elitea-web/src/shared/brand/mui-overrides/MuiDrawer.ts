import type { EliteaComponents } from '../theme-types';

/**
 * `MuiDrawer` (R-T12). Ported from `MainTheme.js:309-321`. The baseline
 * targeted `styleOverrides.paperAnchorLeft`/`paperAnchorRight` — combined
 * "paper element when anchor=X" slot keys that no longer exist on
 * `DrawerClasses` in MUI 9.2 (verified against the installed
 * `drawerClasses.d.ts`: `anchorLeft`/`anchorRight` now apply to the root,
 * not a paper-anchor combination). `variants` keyed on the (fully typed,
 * no augmentation needed) `anchor` prop, targeting the nested `.MuiDrawer-paper`
 * selector, is the 9.2-native equivalent.
 */
export const MuiDrawer: EliteaComponents['MuiDrawer'] = {
  styleOverrides: {
    paper: ({ theme }) => ({
      background: theme.vars.palette.background.secondary,
    }),
  },
  variants: [
    {
      props: { anchor: 'left' },
      style: ({ theme }) => ({
        '& .MuiDrawer-paper': {
          borderRight: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
      }),
    },
    {
      props: { anchor: 'right' },
      style: ({ theme }) => ({
        '& .MuiDrawer-paper': {
          borderLeft: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
      }),
    },
  ],
};
