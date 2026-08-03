/**
 * Ported from `apps/elitea-ui/src/components/Chat/CreatedTimeInfo.jsx` —
 * renders a message's creation time in a human-readable format.
 *
 * Port of `apps/elitea-ui/src/components/Chat/CreatedTimeInfo.jsx`.
 */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import Typography from '@mui/material/Typography';

/** @public Props for `CreatedTimeInfo`. */
export interface CreatedTimeInfoProps {
  /** The creation time string (ISO format). */
  readonly createdAt: string;
  /** Optional updated time. */
  readonly updatedAt?: string;
}

/** Computes the relative-time (or absolute-date fallback) display string for `time`. */
function computeDisplayTime(time: string): string {
  try {
    const date = new Date(time.replace('Z', '+00:00'));
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return time;
  }
}

/**
 * `CreatedTimeInfo` — renders the creation timestamp of a message,
 * showing relative time or absolute date depending on context. The relative
 * value is recomputed every 30s while mounted (baseline:
 * `apps/elitea-ui/src/components/Chat/CreatedTimeInfo.jsx:11-21`'s
 * `setInterval`), so e.g. "just now" advances to "1m ago" without a remount.
 */
export function CreatedTimeInfo({ createdAt, updatedAt }: CreatedTimeInfoProps): ReactNode {
  const time = updatedAt || createdAt;
  const [displayTime, setDisplayTime] = useState(() => (time ? computeDisplayTime(time) : ''));

  useEffect(() => {
    if (!time) return;
    setDisplayTime(computeDisplayTime(time));

    const intervalId = setInterval(() => {
      setDisplayTime(computeDisplayTime(time));
    }, 30000);

    return () => {
      clearInterval(intervalId);
    };
  }, [time]);

  if (!time) return null;

  return (
    <Typography
      variant="caption"
      sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}
    >
      {displayTime}
    </Typography>
  );
}
