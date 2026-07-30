/**
 * Ported from `apps/elitea-ui/src/components/Chat/EditingPlaceholder.jsx` —
 * a placeholder shown while a message is being edited.
 *
 * Port of `apps/elitea-ui/src/components/Chat/EditingPlaceholder.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';

/** @public Props for `EditingPlaceholder`. */
export interface EditingPlaceholderProps {
  /** Whether editing is active. */
  readonly isEditing?: boolean;
  /** Progress indicator (0-1). */
  readonly progress?: number;
}

/**
 * `EditingPlaceholder` — renders a loading placeholder for the editing state.
 */
export function EditingPlaceholder({
  isEditing = false,
  progress = 0.5,
}: EditingPlaceholderProps): ReactNode {
  if (!isEditing) return null;

  return (
    <Box
      data-testid="editing-placeholder"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 1,
        px: 2,
      }}
    >
      <LinearProgress
        variant="determinate"
        value={progress * 100}
        sx={{ flex: 1 }}
      />
    </Box>
  );
}
