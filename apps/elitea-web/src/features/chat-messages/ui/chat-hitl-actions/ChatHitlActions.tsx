/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-hitl-actions/
 * ChatHitlActions.jsx` — renders HITL (Human-In-The-Loop) approval controls
 * for paused agent execution.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-hitl-actions/
 * ChatHitlActions.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/** @public Props for `ChatHitlActions`. */
export interface ChatHitlActionsProps {
  /** The HITL interrupt data. */
  readonly hitlInterrupt: {
    readonly message?: string;
    readonly tool_name?: string;
    readonly toolkit_name?: string;
    readonly available_actions?: readonly string[];
    readonly decided?: boolean;
    readonly tool_call_id?: string;
  };
  /** The tool call ID for routing. */
  readonly toolCallId?: string;
  /** Called when HITL is resumed. */
  readonly onHitlResume?: (() => void) | undefined;
  /** Whether the actions are disabled. */
  readonly disabled?: boolean;
}

/**
 * `ChatHitlActions` — renders approval/edit/reject buttons for HITL
 * paused agent execution.
 */
export function ChatHitlActions({
  hitlInterrupt,
  toolCallId: _toolCallId,
  onHitlResume,
  disabled = false,
}: ChatHitlActionsProps): ReactNode {
  if (!hitlInterrupt || hitlInterrupt.decided) return null;

  const actions = hitlInterrupt.available_actions ?? ['approve', 'reject'];

  return (
    <Box
      data-testid="chat-hitl-actions"
      sx={{
        mt: 1,
        p: 1.5,
        border: '1px solid',
        borderColor: 'warning.main',
        // eslint-disable-next-line elitea/ad-hoc-radius — warning banner border radius
        borderRadius: 1,
        backgroundColor: 'warning.lighter',
      }}
    >
      {hitlInterrupt.message && (
        <Typography
          variant="body2"
          sx={{ mb: 1, color: 'warning.dark' }}
        >
          {hitlInterrupt.message}
        </Typography>
      )}
      <Stack
        direction="row"
        spacing={1}
      >
        {/* eslint-disable-next-line i18next/no-literal-string — action key comparison */}
        {actions.includes('approve') && (
          <Button
            size="small"
            variant="contained"
            color="success"
            onClick={() => onHitlResume?.()}
            disabled={disabled}
          >
            {/* eslint-disable-next-line i18next/no-literal-string — HITL action label */}
            Approve
          </Button>
        )}
        {/* eslint-disable-next-line i18next/no-literal-string — action key comparison */}
        {actions.includes('reject') && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={() => onHitlResume?.()}
            disabled={disabled}
          >
            {/* eslint-disable-next-line i18next/no-literal-string — HITL action label */}
            Reject
          </Button>
        )}
        {/* eslint-disable-next-line i18next/no-literal-string — action key comparison */}
        {actions.includes('edit') && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => onHitlResume?.()}
            disabled={disabled}
          >
            {/* eslint-disable-next-line i18next/no-literal-string — HITL action label */}
            Edit
          </Button>
        )}
      </Stack>
    </Box>
  );
}
