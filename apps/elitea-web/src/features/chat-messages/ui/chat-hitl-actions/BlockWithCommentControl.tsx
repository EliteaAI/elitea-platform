/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-hitl-actions/
 * BlockWithCommentControl.jsx` — renders a block control with optional
 * comment for HITL pause decisions.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-hitl-actions/
 * BlockWithCommentControl.jsx`.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

/** @public Props for `BlockWithCommentControl`. */
export interface BlockWithCommentControlProps {
  /** Whether the block is currently active/paused. */
  readonly isActive?: boolean;
  /** Called when the block is approved. */
  readonly onApprove?: (() => void) | undefined;
  /** Called when the block is rejected. */
  readonly onReject?: ((comment: string) => void) | undefined;
  /** Whether the component is disabled. */
  readonly disabled?: boolean;
}

/**
 * `BlockWithCommentControl` — renders approve/reject buttons with an
 * optional comment field for rejection.
 */
export function BlockWithCommentControl({
  isActive: _isActive,
  onApprove,
  onReject,
  disabled = false,
}: BlockWithCommentControlProps): ReactNode {
  const [comment, setComment] = useState('');

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
      <TextField
        multiline
        minRows={2}
        fullWidth
        // eslint-disable-next-line i18next/no-literal-string — placeholder text
        placeholder="Add a comment (optional)..."
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        disabled={disabled}
        size="small"
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          size="small"
          variant="contained"
          color="success"
          onClick={onApprove}
          disabled={disabled}
        >
          {/* eslint-disable-next-line i18next/no-literal-string — HITL action label */}
          Approve
        </Button>
        <Button
          size="small"
          variant="contained"
          color="error"
          onClick={() => onReject?.(comment)}
          disabled={disabled}
        >
          {/* eslint-disable-next-line i18next/no-literal-string — HITL action label */}
          Reject
        </Button>
      </Box>
    </Box>
  );
}
