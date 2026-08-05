/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-hitl-actions/
 * EditControl.jsx` — renders an inline edit control for HITL pause resume.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-hitl-actions/
 * EditControl.jsx`.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

/** @public Props for `EditControl`. */
export interface EditControlProps {
  /** The current value to edit. */
  readonly currentValue: string;
  /** Called when edit is submitted. */
  readonly onSubmit: (newValue: string) => void;
  /** Called when edit is cancelled. */
  readonly onCancel?: (() => void) | undefined;
  /** Placeholder text. */
  readonly placeholder?: string;
  /** Whether the control is disabled. */
  readonly disabled?: boolean;
}

/**
 * `EditControl` — renders an inline text area with submit/cancel buttons
 * for HITL-edit flow.
 */
export function EditControl({
  currentValue,
  onSubmit,
  onCancel,
  placeholder = 'Enter edit...',
  disabled = false,
}: EditControlProps): ReactNode {
  const [value, setValue] = useState(currentValue);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
      <TextField
        multiline
        minRows={2}
        maxRows={6}
        fullWidth
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        size="small"
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          size="small"
          variant="contained"
          onClick={() => onSubmit(value)}
          disabled={disabled || !value.trim()}
        >
          {/* eslint-disable-next-line i18next/no-literal-string — edit action label */}
          Submit
        </Button>
        {onCancel && (
          <Button
            size="small"
            variant="outlined"
            onClick={onCancel}
            disabled={disabled}
          >
            {/* eslint-disable-next-line i18next/no-literal-string — edit action label */}
            Cancel
          </Button>
        )}
      </Box>
    </Box>
  );
}
