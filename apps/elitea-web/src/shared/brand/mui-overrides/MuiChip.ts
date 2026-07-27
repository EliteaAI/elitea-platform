import type { EliteaComponents } from '../theme-types';

/**
 * `MuiChip` — canonical elitea-ui shape (`MainTheme.js:217-227`), token-wired.
 *
 * Unit T2 §3 classified admin-ui's chip as class (b): it branches on the
 * palette mode in JavaScript (an R-T2 violation) and adds a transparent
 * `outlined` rework plus a `deleteIcon` override. None of that is
 * ported — the branch is precisely what the CSS-variable layer exists to
 * delete, and the canonical two-slot override below is scheme-correct by
 * construction.
 */
export const MuiChip: EliteaComponents['MuiChip'] = {
  styleOverrides: {
    root: ({ theme }) => ({
      background: theme.vars.palette.background.avatar,
    }),
    outlined: ({ theme }) => ({
      background: theme.vars.palette.background.eliteaDefault,
      color: theme.vars.palette.text.secondary,
    }),
  },
};
