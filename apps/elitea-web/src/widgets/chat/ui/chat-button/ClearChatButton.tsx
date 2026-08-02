import { memo } from 'react';

import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

/**
 * Chat button primitive: ClearChatButton
 *
 * Renders a trash / delete icon button that clears the current chat.
 *
 * Prop contract (injected by the composition root through `slots.renderClearChatButton`):
 *   - `disabled` — disable the button (e.g. when chat is empty)
 *   - `onClear`  — fire the clear action
 */
export interface ClearChatButtonProps {
  disabled?: boolean;
  onClear?: () => void;
}

export const ClearChatButton = memo(({ disabled = false, onClear }: ClearChatButtonProps) => {
  return (
    <Tooltip title="Clear chat" placement="top">
      <Box component="span">
        <IconButton
          color="secondary"
          aria-label="clear chat"
          disabled={disabled}
          onClick={onClear}
          sx={{ marginLeft: 0 }}
        >
          <DeleteOutlinedIcon fontSize="small" />
        </IconButton>
      </Box>
    </Tooltip>
  );
});

ClearChatButton.displayName = 'ClearChatButton';

export default ClearChatButton;
