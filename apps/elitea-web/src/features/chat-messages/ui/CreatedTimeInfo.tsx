/**
 * Ported from `apps/elitea-ui/src/components/Chat/CreatedTimeInfo.jsx` —
 * renders a message's creation time in a human-readable format.
 *
 * Port of `apps/elitea-ui/src/components/Chat/CreatedTimeInfo.jsx`.
 */
import type { ReactNode } from 'react';

import Typography from '@mui/material/Typography';

/** @public Props for `CreatedTimeInfo`. */
export interface CreatedTimeInfoProps {
  /** The creation time string (ISO format). */
  readonly createdAt: string;
  /** Optional updated time. */
  readonly updatedAt?: string;
}

/**
 * `CreatedTimeInfo` — renders the creation timestamp of a message,
 * showing relative time or absolute date depending on context.
 */
export function CreatedTimeInfo({ createdAt, updatedAt }: CreatedTimeInfoProps): ReactNode {
  const time = updatedAt || createdAt;
  if (!time) return null;

  let displayTime = '';
  try {
    const date = new Date(time.replace('Z', '+00:00'));
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) displayTime = 'just now';
    else if (diffMins < 60) displayTime = `${diffMins}m ago`;
    else if (diffHours < 24) displayTime = `${diffHours}h ago`;
    else if (diffDays < 7) displayTime = `${diffDays}d ago`;
    else displayTime = date.toLocaleDateString();
  } catch {
    displayTime = time;
  }

  return (
    <Typography
      variant="caption"
      sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}
    >
      {displayTime}
    </Typography>
  );
}
