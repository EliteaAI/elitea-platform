/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/error-trace/
 * ErrorTrace.jsx` — renders an error trace for a failed message.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/error-trace/
 * ErrorTrace.jsx`.
 */
import type { ReactNode } from 'react';

import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { useState } from 'react';

/** @public Props for `ErrorTrace`. */
export interface ErrorTraceProps {
  /** The error message/exception to display. */
  readonly error: unknown;
  /** Whether to expand the trace by default. */
  readonly defaultExpanded?: boolean;
}

/**
 * `ErrorTrace` — renders an expandable error trace panel showing the
 * error message and stack trace (if available).
 */
export function ErrorTrace({ error, defaultExpanded = false }: ErrorTraceProps): ReactNode {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!error) return null;

  const errorMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : JSON.stringify(error);

  return (
    <Box
      data-testid="error-trace"
      sx={{
        mt: 1,
        mb: 1,
        border: '1px solid',
        borderColor: 'error.main',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          backgroundColor: 'error.lighter',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <ErrorOutlinedIcon
          color="error"
          fontSize="small"
        />
        <Typography
          variant="body2"
          color="error.main"
          sx={{ flex: 1 }}
        >
          Error
        </Typography>
        <IconButton
          size="small"
          sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
        >
          ▾
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <Box
          sx={{
            p: 1.5,
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            color: 'error.main',
            backgroundColor: 'error.lighter',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {errorMessage}
        </Box>
      </Collapse>
    </Box>
  );
}
