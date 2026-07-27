import type { EliteaComponents } from '../theme-types';

/**
 * `MuiMenuList` (R-T12). Simplified from
 * `apps/elitea-ui/src/theme/menuListVariants.js`'s `eliteaMenuListVariants`:
 * the baseline declares 8 near-duplicate variants (`dense`/`icon`/`compact`/
 * `elevated`/`context`/`navigation`/`user`), most of which read MUI's
 * un-tokenised `palette.action.*` / `palette.primary.light` (not part of
 * this app's palette) and have no call site in the shared/ui port. The
 * default (untagged) variant — the one every `<MenuList>` actually
 * receives — is preserved in full, token-driven form.
 */
export const MuiMenuList: EliteaComponents['MuiMenuList'] = {
  variants: [
    {
      props: {},
      style: ({ theme }) => ({
        padding: `${theme.spacing(1)} 0`,
        backgroundColor: theme.vars.palette.background.secondary,
        borderRadius: theme.vars.shape.radiusMd,
        border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        boxShadow: theme.vars.palette.boxShadow.default,
      }),
    },
  ],
};
