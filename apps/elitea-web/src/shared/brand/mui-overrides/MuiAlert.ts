import type { EliteaComponents } from '../theme-types';

/**
 * `MuiAlert` (R-T12). **Re-authored, not ported** — see OWNERSHIP.md note 1.
 * The baseline (`MainTheme.js:276-299`) targets `styleOverrides.filledSuccess`
 * /`filledError`/`filledWarning`/`filledInfo` — combined slot keys that no
 * longer exist on `AlertClasses` in MUI 9.2 (verified against the installed
 * `alertClasses.d.ts`: `filled` and `colorSuccess`/`colorError`/
 * `colorWarning`/`colorInfo` are now separate classes, both applied to the
 * root). The `variant`+`color` `variants` matcher below is the 9.2-native
 * equivalent and — as a beneficial side effect — deletes the CSS named
 * colours (`'green'`/`'red'`/`'orange'`) the baseline used, which is exactly
 * what R-T1 exists to catch (T2 §3 calls this a shared elitea-ui/admin-ui
 * defect). `contrastText` (not a hard-coded `'white'`) keeps each filled
 * surface's text colour correct for a brand pack whose role colours are not
 * necessarily white-on-dark.
 */
export const MuiAlert: EliteaComponents['MuiAlert'] = {
  variants: [
    {
      props: { variant: 'filled', color: 'success' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.success.main,
        color: theme.vars.palette.success.contrastText,
      }),
    },
    {
      props: { variant: 'filled', color: 'error' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.error.main,
        color: theme.vars.palette.error.contrastText,
      }),
    },
    {
      props: { variant: 'filled', color: 'info' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.info.main,
        color: theme.vars.palette.info.contrastText,
      }),
    },
    {
      props: { variant: 'filled', color: 'warning' },
      style: ({ theme }) => ({
        backgroundColor: theme.vars.palette.warning.main,
        color: theme.vars.palette.warning.contrastText,
      }),
    },
  ],
};
