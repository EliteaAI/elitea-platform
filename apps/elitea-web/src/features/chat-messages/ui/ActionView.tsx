/**
 * Ported from `apps/elitea-ui/src/components/Chat/ActionView.jsx` — renders
 * a single tool action in the streaming/complete view.
 *
 * Port of `apps/elitea-ui/src/components/Chat/ActionView.jsx`.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { ToolModal } from './ToolModal';

/** @public Props for `ActionView`. */
export interface ActionViewProps {
  /** The action data to render. */
  readonly action: {
    readonly type?: string;
    readonly name?: string;
    readonly content?: string;
    readonly toolInputs?: unknown;
    readonly toolOutputs?: string;
    readonly toolMeta?: Record<string, unknown>;
    readonly isError?: boolean;
    readonly status?: string;
    readonly timestamp?: string;
  };
  /** Called when the action is clicked. */
  readonly onClick?: (() => void) | undefined;
  /** Whether the action is selected. */
  readonly isSelected?: boolean;
}

/**
 * `ActionView` — renders a single tool action (thinking step, tool call,
 * or LLM response) in the streaming or completed state. Clicking it opens
 * a `ToolModal` with that action's full input/output detail.
 */
export function ActionView({ action, onClick, isSelected = false }: ActionViewProps): ReactNode {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const displayText = action.content || action.toolOutputs || '';
  const isError = action.isError || action.status === 'error';

  const handleClick = (): void => {
    onClick?.();
    setIsModalOpen(true);
  };

  return (
    <>
      <Box
        onClick={handleClick}
        sx={{
          p: 1,
          mb: 0.5,
          borderRadius: 0.5,
          border: isSelected ? '1px solid' : '1px solid transparent',
          borderColor: isError ? 'error.main' : isSelected ? 'primary.main' : 'transparent',
          backgroundColor: isError ? 'error.lighter' : isSelected ? 'action.selected' : 'transparent',
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          overflow: 'hidden',
        }}
      >
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            color: isError ? 'error.main' : 'primary.main',
            fontWeight: 600,
            mb: 0.25,
          }}
        >
          {action.name || action.type || 'Action'}
        </Typography>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            color: 'text.secondary',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {displayText || '...'}
        </Typography>
      </Box>
      <ToolModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        toolAction={action}
      />
    </>
  );
}
