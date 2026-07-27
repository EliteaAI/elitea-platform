import type { EliteaComponents } from '../theme-types';

import { MuiButton } from './MuiButton';
import { MuiChip } from './MuiChip';

/**
 * The R-T12 override package: MUI `styleOverrides` exist ONLY under this
 * directory, one file per `Mui*` key, and every one of them reads
 * `theme.vars.*` — no raw colours, no scheme branches, no `!important`.
 *
 * Composition is a plain object literal so the set of wired keys is
 * greppable and the file stays a table of contents rather than logic.
 * Ownership of the remaining keys is recorded in OWNERSHIP.md.
 */
export function muiOverrides(): EliteaComponents {
  return { MuiButton, MuiChip };
}
