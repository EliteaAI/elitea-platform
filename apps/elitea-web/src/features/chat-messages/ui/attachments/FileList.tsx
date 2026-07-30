/**
 * Ported from `apps/elitea-ui/src/components/Chat/FileList.jsx` — renders
 * a list of file attachments with delete buttons.
 *
 * This component is the consumer of `features/chat-input`'s slot contract:
 * `slots.attachmentList` receives `{ attachments, onDeleteAttachment, disabled }`
 * from `UserInputAttachmentListSlotProps`.
 *
 * Also used by `ChatMessageList` / `ApplicationAnswer` to render the
 * attachment summary inline with message content.
 *
 * Port of `apps/elitea-ui/src/components/Chat/FileList.jsx`.
 */
import type { ReactNode } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';

import type { Attachment } from '@/entities/attachment';

/** @public Props for `FileList`. */
export interface FileListProps {
  /** The list of attachments to display. */
  readonly attachments: readonly Attachment[];
  /** Called when a user clicks the delete button on an attachment. */
  readonly onDeleteAttachment?: ((index: number) => void) | undefined;
  /** Disables the delete buttons. */
  readonly disabled?: boolean;
}

/**
 * `FileList` — renders a horizontal scrollable list of file-name chips,
 * each with a close button for deletion.
 */
export function FileList({ attachments, onDeleteAttachment, disabled = false }: FileListProps): ReactNode {
  if (!attachments?.length) return null;

  return (
    <Box sx={{ mb: 1, maxHeight: '60px', overflowX: 'auto', overflowY: 'hidden' }}>
      <List
        disablePadding
        sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap' }}
      >
        {attachments.map((attachment, index) => {
          const key = (attachment as Record<string, unknown>)?.id != null
            ? (attachment as Record<string, unknown>)?.id as React.Key
            : index;
          return (
            <ListItem
              key={key}
              disableGutters
              sx={{ p: 0 }}
            >
              <Chip
                label={((attachment as Record<string, unknown>)?.name ?? `File ${index + 1}`) as string}
                size="small"
                variant="outlined"
                sx={{
                  maxWidth: '200px',
                  '& .MuiChip-label': {
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                }}
                deleteIcon={
                  <CloseIcon fontSize="small" />
                }
                onDelete={
                  onDeleteAttachment && !disabled
                    ? () => onDeleteAttachment(index)
                    : undefined
                }
              />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
