import type { EliteaComponents } from '../theme-types';

/**
 * `MuiButton` (R-T12: one file per MUI key, styleOverrides live only here).
 *
 * SCOPE. This is the token wiring for the six variants that carried the
 * §4.1 Blocker-1 hard-coded accents. All fifteen scheme-branch call sites in
 * `BaseBtn.jsx` now resolve to tokens, so the file contains zero raw colours
 * and zero scheme branches. Geometry (sizes, paddings, icon
 * slots, the `50%` icon-only radius) and the remaining variants belong to
 * unit S1; see OWNERSHIP.md, which also records the one rule conflict S1
 * will hit.
 *
 * Every value below is `theme.vars.palette.*`, i.e. a `var(--el-palette-…)`
 * reference resolved by the CSS-variable layer — which is what makes the
 * same stylesheet correct in both schemes without a branch.
 */
export const MuiButton: EliteaComponents['MuiButton'] = {
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
      // BaseBtn.jsx:689-731 — was: mode ? 'rgba(41,184,245,…)' : 'rgba(196,40,221,…)'
      props: { variant: 'maxi' },
      style: ({ theme }) => ({
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
  ],
};
