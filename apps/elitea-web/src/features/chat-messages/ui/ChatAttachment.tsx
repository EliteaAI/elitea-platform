/**
 * Ported from `apps/elitea-ui/src/components/Chat/ChatAttachment.jsx` —
 * renders an individual attachment (image or normal file).
 *
 * Port of `apps/elitea-ui/src/components/Chat/ChatAttachment.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';

import { getFileFormat } from '@/shared/lib/file';

import type { Attachment } from '@/entities/attachment';

/** Checks whether `attachment` represents an image file. */
function isImageFile(attachment: Attachment): boolean {
  if (typeof attachment === 'string') return false;
  if (attachment instanceof File) {
    return attachment.type?.startsWith('image/') ?? false;
  }
  // AttachmentRecord — fall back to filename extension check
  const name = (attachment as Record<string, unknown>)?.name as string | undefined;
  if (name) {
    const ext = getFileFormat(name);
    return ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp' || ext === 'svg' || ext === 'bmp';
  }
  return false;
}

/** @public Props for `ChatAttachment`. */
export interface ChatAttachmentProps {
  /** The attachment to render. */
  readonly attachment: Attachment;
  /** Called when the attachment is clicked. */
  readonly onClick?: (() => void) | undefined;
  /** Whether the attachment is in a read-only view. */
  readonly readonly?: boolean;
}

/**
 * `ChatAttachment` — renders an individual attachment as a card,
 * showing either a preview (for images) or a file icon with name.
 */
export function ChatAttachment({ attachment, onClick, readonly = false }: ChatAttachmentProps): ReactNode {
  const a = attachment as Record<string, unknown>;
  const isImage = (a.contentType as string | undefined)?.startsWith('image/') || isImageFile(attachment);

  return (
    <Card
      onClick={readonly ? undefined : onClick}
      sx={{
        maxWidth: '200px',
        cursor: readonly ? 'default' : 'pointer',
        transition: 'box-shadow 0.2s',
        '&:hover': {
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        },
      }}
    >
      {isImage && a.previewUrl ? (
        <Box
          component="img"
          src={a.previewUrl as string}
          alt={(a.name as string) ?? 'Attachment'}
          sx={{
            width: '100%',
            height: '120px',
            objectFit: 'cover',
            borderRadius: '6px 6px 0 0',
          }}
        />
      ) : (
        <Box
          sx={{
            height: '60px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'action.hover',
            borderRadius: '6px 6px 0 0',
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary' }}
          >
            File
          </Typography>
        </Box>
      )}
      <Box sx={{ p: 1 }}>
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {(a.name as string) || 'Untitled'}
        </Typography>
      </Box>
    </Card>
  );
}
