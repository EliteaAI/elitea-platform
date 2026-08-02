import { memo, forwardRef, useImperativeHandle } from 'react';

import { Box, IconButton, Tooltip } from '@mui/material';

/**
 * Phase-2 Chat button primitive: AttachmentButton
 * Stub — no external dependencies. Full implementation wired in Phase 5.
 */
export type AttachmentButtonHandle = {
  onDrop: (event: { dataTransfer: { files: File[] }; preventDefault: () => void }) => void;
};

type AttachmentButtonProps = {
  onAttachFiles?: (files: File | File[]) => void;
  disableAttachments?: boolean;
  attachments?: File[];
  limits?: Record<string, number>;
};

const AttachmentButton = memo(
  forwardRef<AttachmentButtonHandle, AttachmentButtonProps>(
    ({ disableAttachments = false, attachments = [] }, ref) => {
      useImperativeHandle(ref, () => ({
        onDrop: (event: { dataTransfer: { files: File[] }; preventDefault: () => void }) => {
          event.preventDefault();
        },
      }));

      return (
        <Tooltip title={`Attach Files (${attachments?.length ?? 0} left)`} placement="top">
          <Box component="span">
            <IconButton
              color="secondary"
              aria-label="attach files"
              disabled={disableAttachments}
              sx={{ marginLeft: 0 }}
            >
              <Box component="span" sx={{ fontSize: '1rem' }}>
                📎
              </Box>
            </IconButton>
          </Box>
        </Tooltip>
      );
    },
  ),
);

AttachmentButton.displayName = 'AttachmentButton';

export default AttachmentButton;
