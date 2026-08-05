/**
 * Ported from `apps/elitea-ui/src/components/Chat/ToolModal.jsx` — renders
 * a modal for viewing tool execution details.
 *
 * Port of `apps/elitea-ui/src/components/Chat/ToolModal.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import CloseIcon from '@mui/icons-material/Close';

/** @public Props for `ToolModal`. */
export interface ToolModalProps {
  /** Whether the modal is open. */
  readonly open: boolean;
  /** Called when the modal is closed. */
  readonly onClose: () => void;
  /** The tool action data to display. */
  readonly toolAction: {
    readonly name?: string;
    readonly type?: string;
    readonly toolInputs?: unknown;
    readonly toolOutputs?: unknown;
    readonly toolMeta?: Record<string, unknown>;
    readonly content?: string;
    readonly isError?: boolean;
  };
}

/**
 * `ToolModal` — renders a detail modal for a tool execution,
 * showing inputs, outputs, and metadata.
 */
export function ToolModal({ open, onClose, toolAction }: ToolModalProps): ReactNode {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography variant="h6">
          {toolAction.name || toolAction.type || 'Tool'}
        </Typography>
        <IconButton
          size="small"
          onClick={onClose}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        {toolAction.toolInputs !== undefined && (
          <Box sx={{ mb: 2 }}>
            <Typography
              variant="subtitle2"
              sx={{ mb: 0.5, color: 'text.secondary' }}
            >
              Inputs
            </Typography>
            <Box
              component="pre"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                p: 1,
                backgroundColor: 'action.hover',
                borderRadius: 1,
                overflow: 'auto',
              }}
            >
              {typeof toolAction.toolInputs === 'string'
                ? toolAction.toolInputs
                : JSON.stringify(toolAction.toolInputs, null, 2)}
            </Box>
          </Box>
        )}
        {toolAction.toolOutputs !== undefined && (
          <Box sx={{ mb: 2 }}>
            <Typography
              variant="subtitle2"
              sx={{ mb: 0.5, color: 'text.secondary' }}
            >
              Outputs
            </Typography>
            <Box
              component="pre"
              sx={{
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                p: 1,
                backgroundColor: 'action.hover',
                borderRadius: 1,
                overflow: 'auto',
              }}
            >
              {typeof toolAction.toolOutputs === 'string'
                ? toolAction.toolOutputs
                : JSON.stringify(toolAction.toolOutputs, null, 2)}
            </Box>
          </Box>
        )}
        {toolAction.content && (
          <Box>
            <Typography
              variant="subtitle2"
              sx={{ mb: 0.5, color: 'text.secondary' }}
            >
              Content
            </Typography>
            <Typography
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap' }}
            >
              {toolAction.content}
            </Typography>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
