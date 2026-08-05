import type { EliteaComponents } from '../theme-types';

/**
 * `MuiList` (R-T12; file/key renamed from the original `MuiMenuList`).
 *
 * `<MenuList>` has no styled root of its own — verified by reading the
 * installed `@mui/material/MenuList/MenuList.js`: it renders `<List>`
 * directly (`jsx(List, {...})`), and only `List.js` calls
 * `useDefaultProps({name: 'MuiList'})`. `MuiMenuList` is not a real,
 * consultable `theme.components` key for anything MUI actually renders —
 * registering overrides under it was pure dead configuration, caught by a
 * real 0%-function-coverage regression in `src/shared/brand/**`'s coverage
 * gate, then confirmed empirically: a `<MenuList>` rendered through this
 * app's real theme had no `borderRadius` at all before this fix (a
 * `getComputedStyle` probe, not a guess). `<List>` is not used unwrapped
 * anywhere else in this app (grepped), so retargeting the key to the one
 * MUI actually reads has no effect beyond what was originally intended for
 * every current `<MenuList>` consumer (`ControlsDropdown`, `SingleSelect`).
 *
 * Simplified from `apps/elitea-ui/src/theme/menuListVariants.js`'s
 * `eliteaMenuListVariants`: the baseline declares 8 near-duplicate variants
 * (`dense`/`icon`/`compact`/`elevated`/`context`/`navigation`/`user`), most
 * of which read MUI's un-tokenised `palette.action.*` / `palette.primary.
 * light` (not part of this app's palette) and have no call site in the
 * shared/ui port. The default (untagged) variant — the one every
 * `<MenuList>` actually receives — is preserved in full, token-driven form.
 */
export const MuiList: EliteaComponents['MuiList'] = {
  variants: [
    {
      props: {},
      style: ({ theme }) => ({
        minWidth: '12.5rem',
        padding: `${theme.spacing(1)} 0`,
        backgroundColor: theme.vars.palette.background.secondary,
        borderRadius: theme.vars.shape.radiusMd,
        border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        boxShadow: theme.vars.palette.boxShadow.default,
      }),
    },
  ],
};
