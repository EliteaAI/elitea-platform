import type { ReactNode } from 'react';

import Typography from '@mui/material/Typography';

/**
 * Minimal, local presentational replacement for `AuthorContainer`
 * (`apps/elitea-ui/src/components/AuthorContainer.jsx`) — avatar stacking,
 * the popover-on-click "+N more" overflow, and per-author navigation are
 * NOT reproduced (they depend on `UserAvatar`/`CardPopover`, both `src/
 * components/` "legacy"-layer components — never ported to `shared/ui`'s
 * 67-component S1 set, and outside this unit's ownership fence to add).
 * Flagged in the A12 report. This renders the plain, comma-joined author
 * name list only — the data-bearing part of the baseline component, not
 * its avatar chrome.
 */
export interface AuthorNamesProps {
  readonly names: readonly string[];
}

export function AuthorNames({ names }: AuthorNamesProps): ReactNode {
  if (names.length === 0) return null;
  return (
    <Typography
      variant="bodyMedium"
      component="span"
      sx={(theme) => ({ color: theme.vars.palette.text.secondary })}
    >
      {names.join(', ')}
    </Typography>
  );
}
