/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-continue/
 * ChatContinue.jsx` — renders a "Continue" button for resuming MCP/agent
 * execution that was paused.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-continue/
 * ChatContinue.jsx`.
 */
import type { ReactNode } from 'react';

import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';

/** @public Props for `ChatContinue`. */
export interface ChatContinueProps {
  /** Whether to continue execution without authentication (skip auth). */
  readonly onContinueWithoutAuth?: (() => void) | undefined;
  /** Whether to continue after successful authentication. */
  readonly onAuthSuccess?: (() => void) | undefined;
  /** Called when the user requests to continue. */
  readonly onContinue?: (() => void) | undefined;
  /** Whether authentication is required. */
  readonly authRequired?: boolean;
  /** Whether confirmation is required. */
  readonly requiresConfirmation?: boolean;
  /** Whether the continue button is disabled. */
  readonly disabled?: boolean;
}

/**
 * `ChatContinue` — renders a continuation button with optional auth
 * confirmation flow for MCP tool execution.
 */
export function ChatContinue({
  onContinueWithoutAuth,
  onAuthSuccess,
  onContinue,
  authRequired = false,
  requiresConfirmation = false,
  disabled = false,
}: ChatContinueProps): ReactNode {
  if (!authRequired && !requiresConfirmation) {
    return null;
  }

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ mt: 1, mb: 1 }}
    >
      {authRequired ? (
        <>
          <Button
            size="small"
            variant="contained"
            startIcon={<PlayArrowIcon />}
            onClick={onAuthSuccess}
            disabled={disabled}
          >
            Continue (Auth)
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={onContinueWithoutAuth}
            disabled={disabled}
          >
            Skip Auth
          </Button>
        </>
      ) : (
        <Button
          size="small"
          variant="contained"
          startIcon={<PlayArrowIcon />}
          onClick={onContinue}
          disabled={disabled}
        >
          Continue
        </Button>
      )}
    </Stack>
  );
}
