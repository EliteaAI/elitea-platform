import type { EliteaComponents } from '../theme-types';
import { MuiButtonDefaultProps, MuiButtonStyleOverrides } from './MuiButton.root';

/**
 * `MuiButton` (R-T12: one file per MUI key, styleOverrides live only here).
 *
 * SCOPE. T1 wired token colour for the six variants carrying the §4.1
 * Blocker-1 hard-coded accents (`special`/`contained`/`secondary`/
 * `iconCounter`/`auxiliary`/`maxi`). Unit S1 (Part B, OWNERSHIP.md) added
 * the remaining eight (`iconLabel`/`tertiary`/`alarm`/`elitea`/`text`/
 * `icon`/`neutral`/`positive`) plus the `maxi`/`icon` geometry their `50%`
 * shape needs, now `theme.vars.shape.radiusPill` (buildTheme.ts). Zero raw
 * colours, zero scheme branches. Radii: baseline `1rem` -> `radiusLg` (16px
 * at the 16px root, MuiDialog.ts's mapping); `1.75rem`/`50%` — both a full
 * pill/circle once CSS clamps radius to the shorter box side — -> `radiusPill`.
 * `alarm`/`neutral`/`positive`/`elitea`-alarm's text was the baseline's
 * literal `'white'` (R-T1 bans named colours); `text.button.primary`
 * (off-white) is the closest token, the one `contained` already uses on a
 * solid background.
 *
 * `elitea`'s four `color`-branched skins (`BaseBtn.jsx:520-618`) are FOUR
 * `props: { variant: 'elitea', color: … }` entries, not one entry branching
 * on `color`: MUI 9.2 types `ComponentsVariants<Theme>['MuiButton'][number]
 * ['style']` as `Interpolation<{ theme: Theme }>` — the callback carries
 * only `theme`, never `color`/`ownerState` (verified against
 * `@mui/styled-engine`'s `.d.ts`; at runtime `color` genuinely is merged in
 * by `@mui/system/createStyled`'s `processStyleVariants`, TS just cannot
 * see it through this type). Matching `{ variant, color }` pairs is MUI's
 * own idiom here and needs no cast.
 *
 * Every leaf token below is spelled out as its own literal
 * `theme.vars.palette.…` chain, not factored through a shared helper
 * indexed by variant name: `reference-scan.test.ts` (§4.6 check 7b) walks
 * the AST for a fully static chain per token and hard-fails a
 * computed/aliased segment, so DRY-ing repeated shapes (`alarm`/`neutral`/
 * `positive`) would hide those tokens from the gate that protects them.
 */
export const MuiButton: EliteaComponents['MuiButton'] = {
  defaultProps: MuiButtonDefaultProps,
  styleOverrides: MuiButtonStyleOverrides,
  variants: [
    {
      // BaseBtn.jsx:50-65 — was: mode ? 'rgba(106,232,250,…)' : 'rgba(245,81,249,…)'
      props: { variant: 'special' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.background.button.special.default,
        color: theme.vars.palette.text.button.specialDefault,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.special.hover,
        },
        '&:active': {
          backgroundColor: theme.vars.palette.background.button.special.pressed,
          color: theme.vars.palette.text.button.specialPressed,
        },
        '&:disabled': {
          backgroundColor: theme.vars.palette.background.button.default,
          color: theme.vars.palette.text.default,
        },
      }),
    },
    {
      // BaseBtn.jsx:66-77 — already token-driven in the baseline.
      props: { variant: 'contained' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.background.button.primary.default,
        color: theme.vars.palette.text.button.primary,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.primary.hover,
        },
        '&:active': { backgroundColor: theme.vars.palette.background.button.primary.pressed },
        '&:disabled': {
          backgroundColor: theme.vars.palette.background.button.primary.disabled,
          color: theme.vars.palette.text.button.primary,
        },
      }),
    },
    {
      // BaseBtn.jsx:78-92 — active colour was branch 88.
      props: { variant: 'secondary' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.background.button.secondary.default,
        color: theme.vars.palette.text.secondary,
        border: '0.0625rem solid transparent',
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.secondary.hover,
        },
        '&:active': {
          backgroundColor: theme.vars.palette.background.button.secondary.pressed,
          color: theme.vars.palette.text.button.secondaryPressed,
          border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
        '&:disabled': {
          backgroundColor: theme.vars.palette.background.button.default,
          color: theme.vars.palette.text.button.disabled,
        },
      }),
    },
    {
      // BaseBtn.jsx:93-110 — active background was branch 103.
      props: { variant: 'iconCounter' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.background.button.secondary.default,
        color: theme.vars.palette.text.secondary,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.secondary.hover,
        },
        '&:active': { backgroundColor: theme.vars.palette.background.button.iconCounter.pressed },
        '&:disabled': {
          backgroundColor: theme.vars.palette.background.button.default,
          color: theme.vars.palette.text.button.disabled,
        },
      }),
    },
    {
      // BaseBtn.jsx:140-160 — all three colours were branches 144/149/154.
      props: { variant: 'auxiliary' },
      style: ({ theme }) => ({
        backgroundColor: 'transparent',
        color: theme.vars.palette.text.button.auxiliaryDefault,
        '&:hover, &:focus-visible': { color: theme.vars.palette.text.button.auxiliaryHover },
        '&:active': { color: theme.vars.palette.text.button.auxiliaryPressed },
        '&:disabled': {
          backgroundColor: 'transparent',
          color: theme.vars.palette.text.button.disabled,
        },
      }),
    },
    {
      // BaseBtn.jsx:689-731 — was: mode ? 'rgba(41,184,245,…)' : 'rgba(196,40,221,…)'.
      // [S1 Part B] Geometry added (width/height/radius) — the FAB's `50%`
      // radius, resolved via `theme.vars.shape.radiusPill`. Colour logic
      // below this point is T1's, untouched.
      props: { variant: 'maxi' },
      style: ({ theme }) => ({
        borderRadius: theme.vars.shape.radiusPill,
        padding: 0,
        minWidth: 'auto',
        width: '3.5rem',
        height: '3.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.vars.palette.background.button.maxi.default,
        color: theme.vars.palette.text.button.maxiDefault,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.maxi.hover,
        },
        '&:active': { backgroundColor: theme.vars.palette.background.button.maxi.pressed },
        '&:disabled': {
          backgroundColor: theme.vars.palette.background.button.default,
          color: theme.vars.palette.text.button.disabled,
        },
      }),
    },
    // ---------------------------------------------------------------------
    // [S1 Part B] The eight remaining variants (OWNERSHIP.md's explicit
    // delegation to unit S1). Each comment cites the `BaseBtn.jsx` line
    // range it was ported from.
    // ---------------------------------------------------------------------
    {
      // BaseBtn.jsx:369-399
      props: { variant: 'iconLabel' },
      style: ({ theme }) => ({
        gap: '0.375rem',
        borderRadius: theme.vars.shape.radiusLg,
        border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        paddingLeft: '0.75rem',
        paddingRight: '0.75rem',
        backgroundColor: theme.vars.palette.background.button.iconLabelButton.default,
        color: theme.vars.palette.text.secondary,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.tertiary.hover,
          border: '0.0625rem solid transparent',
        },
        '&:active': { backgroundColor: theme.vars.palette.background.button.tertiary.pressed, color: theme.vars.palette.text.primary },
        '&:disabled': { backgroundColor: theme.vars.palette.background.button.default, color: theme.vars.palette.text.button.disabled },
      }),
    },
    {
      // BaseBtn.jsx:401-450. Not ported: the icon-only auto-collapse
      // (`getIsIconOnly(ownerState)` — no `ownerState` here, see the file
      // header; use the dedicated `icon` variant instead) and the baseline's
      // `!important` on `minWidth` (R-T5 bans it, no ad-hoc waiver).
      props: { variant: 'tertiary' },
      style: ({ theme }) => ({
        minWidth: '1.75rem',
        borderRadius: theme.vars.shape.radiusLg,
        gap: '0.625rem',
        padding: '0.375rem 1rem',
        backgroundColor: 'transparent',
        color: theme.vars.palette.text.default,
        '--btn-icon-fill': theme.vars.palette.icon.fill.default,
        '& .MuiButton-startIcon path': { fill: 'var(--btn-icon-fill)' },
        '&:hover, &:focus-visible': {
          '--btn-icon-fill': theme.vars.palette.icon.fill.secondary,
          backgroundColor: theme.vars.palette.background.button.tertiary.hover,
          color: theme.vars.palette.text.secondary,
        },
        '&:active': {
          '--btn-icon-fill': theme.vars.palette.icon.fill.secondary,
          backgroundColor: theme.vars.palette.background.button.tertiary.pressed,
          color: theme.vars.palette.text.primary,
        },
        '&:disabled': {
          '--btn-icon-fill': theme.vars.palette.icon.fill.disabled,
          backgroundColor: 'transparent',
          color: theme.vars.palette.text.button.disabled,
        },
      }),
    },
    {
      // BaseBtn.jsx:491-519 — see the file header for the 'white' -> token note.
      props: { variant: 'alarm' },
      style: ({ theme }) => ({
        borderRadius: theme.vars.shape.radiusLg,
        gap: 0,
        backgroundColor: theme.vars.palette.background.button.alarm.default,
        color: theme.vars.palette.text.button.primary,
        '& .MuiButton-startIcon': { color: theme.vars.palette.icon.fill.button },
        '&:hover, &:focus-visible': { backgroundColor: theme.vars.palette.background.button.alarm.hover, color: theme.vars.palette.text.button.primary },
        '&:active': { backgroundColor: theme.vars.palette.background.button.alarm.pressed, color: theme.vars.palette.text.button.primary },
        '&:disabled': { backgroundColor: theme.vars.palette.background.button.alarm.disabled, color: theme.vars.palette.text.button.primary },
      }),
    },
    {
      // BaseBtn.jsx:520-618 — geometry shared by every `color` (see the
      // file header for why the four colours below are separate entries).
      props: { variant: 'elitea' },
      style: ({ theme }) => ({
        padding: '0.375rem 1rem',
        borderRadius: theme.vars.shape.radiusPill,
      }),
    },
    {
      // BaseBtn.jsx:527-545
      props: { variant: 'elitea', color: 'primary' },
      style: ({ theme }) => ({
        color: theme.vars.palette.text.button.primary,
        backgroundColor: theme.vars.palette.background.button.primary.default,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.primary.hover,
        },
        '&:active': { backgroundColor: theme.vars.palette.background.button.primary.pressed },
        '&:disabled': {
          color: theme.vars.palette.text.button.primary,
          backgroundColor: theme.vars.palette.background.button.primary.disabled,
        },
      }),
    },
    {
      // BaseBtn.jsx:547-565
      props: { variant: 'elitea', color: 'secondary' },
      style: ({ theme }) => ({
        color: theme.vars.palette.text.secondary,
        backgroundColor: theme.vars.palette.background.button.secondary.default,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.secondary.hover,
        },
        '&:active': {
          color: theme.vars.palette.text.primary,
          backgroundColor: theme.vars.palette.background.button.secondary.pressed,
          border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
        '&:disabled': { color: theme.vars.palette.text.button.disabled, backgroundColor: theme.vars.palette.background.button.default },
      }),
    },
    {
      // BaseBtn.jsx:567-593
      props: { variant: 'elitea', color: 'tertiary' },
      style: ({ theme }) => ({
        color: theme.vars.palette.text.default,
        backgroundColor: 'transparent',
        minWidth: '1.75rem',
        borderRadius: theme.vars.shape.radiusLg,
        padding: '0.375rem 0.75rem',
        gap: '0.625rem',
        '&:hover, &:focus-visible': { backgroundColor: theme.vars.palette.background.button.tertiary.hover, color: theme.vars.palette.text.secondary },
        '&:active': { color: theme.vars.palette.text.primary, backgroundColor: theme.vars.palette.background.button.tertiary.pressed },
        '&:disabled': { color: theme.vars.palette.text.button.disabled, backgroundColor: 'transparent' },
      }),
    },
    {
      // BaseBtn.jsx:595-616 — see the file header for the 'white' -> token note.
      props: { variant: 'elitea', color: 'alarm' },
      style: ({ theme }) => ({
        color: theme.vars.palette.text.button.primary,
        backgroundColor: theme.vars.palette.background.button.alarm.default,
        borderRadius: theme.vars.shape.radiusLg,
        gap: '0.625rem',
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.alarm.hover,
        },
        '&:active': {
          color: theme.vars.palette.text.primary,
          backgroundColor: theme.vars.palette.background.button.alarm.pressed,
          border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
        '&:disabled': {
          color: theme.vars.palette.text.button.primary,
          backgroundColor: theme.vars.palette.background.button.alarm.disabled,
        },
      }),
    },
    {
      // BaseBtn.jsx:620-645
      props: { variant: 'text' },
      style: ({ theme }) => ({
        minWidth: '1.75rem',
        borderRadius: theme.vars.shape.radiusLg,
        padding: '0.375rem',
        gap: '0.625rem',
        backgroundColor: 'transparent',
        color: theme.vars.palette.text.default,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.secondary.default,
        },
        '&:active': {
          backgroundColor: theme.vars.palette.background.button.secondary.pressed,
          color: theme.vars.palette.text.primary,
          border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
        },
        '&:disabled': { backgroundColor: 'transparent', color: theme.vars.palette.text.button.disabled },
      }),
    },
    {
      // BaseBtn.jsx:647-687 — the dedicated icon-only round button.
      props: { variant: 'icon' },
      style: ({ theme }) => ({
        borderRadius: theme.vars.shape.radiusPill,
        padding: 0,
        minWidth: 'auto',
        width: '1.75rem',
        height: '1.75rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.vars.palette.background.button.secondary.default,
        color: theme.vars.palette.text.primary,
        '&:hover, &:focus-visible': {
          backgroundColor: theme.vars.palette.background.button.secondary.hover,
        },
        '&:active': { backgroundColor: theme.vars.palette.background.button.secondary.pressed },
        '&:disabled': {
          backgroundColor: theme.vars.palette.background.button.default,
          color: theme.vars.palette.text.button.disabled,
        },
      }),
    },
    {
      // BaseBtn.jsx:735-763 — see the file header for the 'white' -> token note.
      props: { variant: 'neutral' },
      style: ({ theme }) => ({
        borderRadius: theme.vars.shape.radiusLg,
        gap: 0,
        backgroundColor: theme.vars.palette.background.button.neutral.default,
        color: theme.vars.palette.text.button.primary,
        '& .MuiButton-startIcon': { color: theme.vars.palette.icon.fill.button },
        '&:hover, &:focus-visible': { backgroundColor: theme.vars.palette.background.button.neutral.hover, color: theme.vars.palette.text.button.primary },
        '&:active': { backgroundColor: theme.vars.palette.background.button.neutral.pressed, color: theme.vars.palette.text.button.primary },
        '&:disabled': { backgroundColor: theme.vars.palette.background.button.neutral.disabled, color: theme.vars.palette.text.button.primary },
      }),
    },
    {
      // BaseBtn.jsx:765-793 — see the file header for the 'white' -> token note.
      props: { variant: 'positive' },
      style: ({ theme }) => ({
        borderRadius: theme.vars.shape.radiusLg,
        gap: 0,
        backgroundColor: theme.vars.palette.background.button.positive.default,
        color: theme.vars.palette.text.button.primary,
        '& .MuiButton-startIcon': { color: theme.vars.palette.icon.fill.button },
        '&:hover, &:focus-visible': { backgroundColor: theme.vars.palette.background.button.positive.hover, color: theme.vars.palette.text.button.primary },
        '&:active': { backgroundColor: theme.vars.palette.background.button.positive.pressed, color: theme.vars.palette.text.button.primary },
        '&:disabled': { backgroundColor: theme.vars.palette.background.button.positive.disabled, color: theme.vars.palette.text.button.primary },
      }),
    },
  ],
};
