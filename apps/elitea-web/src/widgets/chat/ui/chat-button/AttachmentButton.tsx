import { memo, forwardRef, useImperativeHandle, useRef, useCallback } from 'react';

import AttachFileIcon from '@mui/icons-material/AttachFile';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

/**
 * Chat button primitive: AttachmentButton
 *
 * Renders an icon button that opens a file-picker dialog. Supports drag-and-
 * drop via the `onDrop` imperative handle (wired by the composition root that
 * also injects `attachmentButtonRef` into `NewChatInput`).
 *
 * Prop contract (injected by the composition root through `slots.attachmentButton`):
 *   - `onAttachFiles`  — called with the selected File(s)
 *   - `disableAttachments` — disables the button / hides file picker
 *   - `attachments` — current list of attached files (used for the tooltip count)
 *   - `limits` — per-extension upload limits (reserved for Phase 5)
 *
 * Imperative handle (`AttachmentButtonHandle`):
 *   - `onDrop(event)` — validates & dispatches dropped files to `onAttachFiles`
 */
export interface AttachmentButtonHandle {
  onDrop(event: { dataTransfer: { files: readonly File[] }; preventDefault(): void }): void;
}

export interface AttachmentButtonProps {
  onAttachFiles?: (files: readonly File[]) => void;
  disableAttachments?: boolean;
  attachments?: readonly File[];
  limits?: Record<string, number>;
}

export const AttachmentButton = memo(
  forwardRef<AttachmentButtonHandle, AttachmentButtonProps>(
    ({ disableAttachments = false, attachments = [], onAttachFiles, limits }, ref) => {
      const fileInputRef = useRef<HTMLInputElement>(null);

      useImperativeHandle(
        ref,
        () => ({
          onDrop: (event: { dataTransfer: { files: readonly File[] }; preventDefault(): void }) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files);
            if (files.length > 0 && !disableAttachments) {
              onAttachFiles?.(files);
            }
          },
        }),
        [onAttachFiles, disableAttachments],
      );

      const handleButtonClick = useCallback(() => {
        fileInputRef.current?.click();
      }, []);

      const handleFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            onAttachFiles?.(Array.from(files));
          }
          // Reset so the same file can be re-selected if needed
          e.target.value = '';
        },
        [onAttachFiles],
      );

      const remaining = limits
        ? Object.entries(limits)
            .map(([ext, max]) => {
              const used = attachments.filter((f) => f.name.toLowerCase().endsWith(ext.toLowerCase())).length;
              return `${max - used} ${ext.replace('.', '')}`;
            })
            .join(', ')
        : `${Math.max(0, attachments.length)} file${attachments.length !== 1 ? 's' : ''}`;

      return (
        <>
          <Tooltip title={remaining} placement="top">
            <Box component="span">
              <IconButton
                color="secondary"
                aria-label="attach files"
                disabled={disableAttachments}
                onClick={handleButtonClick}
                sx={{ marginLeft: 0 }}
              >
                <AttachFileIcon fontSize="small" />
              </IconButton>
            </Box>
          </Tooltip>

          {/* Hidden file input — only accept when attachments aren't disabled */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            disabled={disableAttachments}
            onChange={handleFileChange}
            aria-hidden="true"
          />
        </>
      );
    },
  ),
);

AttachmentButton.displayName = 'AttachmentButton';

export default AttachmentButton;
