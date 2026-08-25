import type { EliteaComponents } from '../theme-types';

/**
 * `MuiButton`'s `defaultProps` + `styleOverrides.root` — the baseline's
 * `BaseBtn.jsx:797-847`.
 *
 * THIS WAS NEVER PORTED, and its absence is why every button in the app
 * looked wrong regardless of variant. Without it MUI's stock Button styling
 * applies underneath `MuiButton.ts`'s `variants` — `text-transform:
 * uppercase`, a 4px radius, `0.875rem/500` Roboto, `6px 16px` padding — so
 * those variants were only ever repainting the colours of a differently
 * shaped button. `variant="outlined"` (21 call sites) got no brand styling
 * at all, since `variants` has no `outlined` entry to repaint it.
 *
 * `height`/`border`/`gap`/`boxShadow` come from the baseline's
 * `baseVariantStyle` (`BaseBtn.jsx:199-238`), which it spreads into ten of
 * its fourteen variants. Hoisting them to `root` is the same result for
 * those ten and a no-op for the four that set their own geometry (`maxi`,
 * `icon`, `iconLabel`, `iconCounter` all restate radius/padding in
 * `MuiButton.ts` and so still win).
 *
 * Its own file purely for `MuiButton.ts`'s `max-lines` budget — R-T12 wants
 * one MUI key per file, and this is still that key.
 *
 * TWO DELIBERATE DEVIATIONS from the baseline text:
 *  - font is `theme.typography.labelSmall` rather than a literal
 *    `0.75rem/500/1rem`. Identical values at the default pack, but R-T11
 *    bans ad-hoc sizes, and going through the variant means a pack that
 *    rescales its type rescales buttons with it.
 *  - the baseline sized the loading spinner with `width/height:
 *    1rem !important`, needed because CircularProgress writes its size to
 *    the `style` attribute. R-T5 bans `!important` without a waiver, and a
 *    rule that loses to an inline style is worse than no rule, so only the
 *    spinner's COLOUR is set here. Call sites needing 1rem pass `size` to
 *    CircularProgress themselves.
 */
export const MuiButtonDefaultProps: NonNullable<EliteaComponents['MuiButton']>['defaultProps'] = {
  disableRipple: true,
};

export const MuiButtonStyleOverrides: NonNullable<EliteaComponents['MuiButton']>['styleOverrides'] = {
  root: ({ theme }) => ({
    position: 'relative',
    '&::before': { display: 'none' },
    textTransform: 'none',
    fontFamily: theme.typography.fontFamily,
    ...theme.typography.labelSmall,
    borderRadius: theme.vars.shape.radiusPill,
    gap: theme.spacing(1),
    border: '0.0625rem solid transparent',
    boxShadow: 'none',
    height: '1.75rem',
    padding: theme.spacing(0.75, 2),
    minWidth: '3rem',
    '& .MuiButton-startIcon': {
      margin: 0,
      width: '1rem',
      height: '1rem',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      '& > svg': { display: 'block', maxWidth: '100%', maxHeight: '100%' },
    },
    '& .MuiButton-endIcon': {
      '& > svg': { display: 'block', maxWidth: '1rem', maxHeight: '1rem' },
    },
    '& .MuiCircularProgress-root': { color: theme.vars.palette.primary.main },
  }),
};
