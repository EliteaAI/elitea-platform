/**
 * ui/attachments/MessageAttachmentList.tsx — list of attachments rendered
 * inside a chat message, ported from
 * `apps/elitea-ui/src/components/Chat/MessageAttachmentList.jsx` (C4 batch).
 *
 * Splits attachments into images (displayed in a responsive grid) and
 * non-image files (displayed as compact cards).
 */
import { useMemo, useState } from 'react';

import { Box } from '@mui/material';

import { NormalAttachment } from './NormalAttachment';
import { ViewImageAttachmentModal } from './ViewImageAttachmentModal';

import type { Attachment } from '@/entities/attachment/model/types';
import { getImageSource as getAttachmentImageSource } from '@/entities/attachment/model/selectors';

/** Re-export for backwards compat — consumers importing from this file still get the type. */
export type { NormalAttachmentArtifactData } from './types';

export interface MessageAttachmentListProps {
  /** The list of attachment objects to render. */
  readonly items?: readonly Attachment[];
  /** Called when the user confirms removal — `fileName` is the display name, `fromStorage` whether to also delete from artifact storage. */
  readonly onRemoveAttachment?: (fileName: string, fromStorage: boolean) => void;
}

/**
 * Renders a grouped list of attachments within a chat message.
 *
 * Matches the baseline `MessageAttachmentList.jsx` behaviour:
 * - Images are grouped and displayed in a responsive CSS grid (max ~16.25rem per column).
 * - Non-image files are displayed as compact cards (baseline: `NormalAttachment`).
 * - Returns `null` when there are no attachments.
 */
export function MessageAttachmentList({
  items = [],
  onRemoveAttachment,
}: MessageAttachmentListProps): React.ReactElement | null {
  const { imagesItems, otherFilesItems } = useMemo(
    () =>
      items.reduce(
        (acc, file) => {
          if (isImageFile(file)) {
            acc.imagesItems.push(file);
          } else {
            acc.otherFilesItems.push(file);
          }
          return acc;
        },
        { imagesItems: [] as Attachment[], otherFilesItems: [] as Attachment[] },
      ),
    [items],
  );

  if (!items?.length) return null;

  return (
    <Box
      sx={{
        width: '100%',
        marginTop: '0.5rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      {imagesItems.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, 16.25rem)',
            justifyContent: 'center',
            gap: '0.5rem',
            marginTop: '0.5rem',
          }}
        >
          {imagesItems.map((file, index) => (
            <ImageAttachmentCard
              key={`${(file as Record<string, unknown>)?.uuid ?? `file_${index}`}`}
              attachment={file}
              onRemoveAttachment={onRemoveAttachment as any}
            />
          ))}
        </Box>
      )}

      {otherFilesItems.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: '0.5rem',
            width: '100%',
            flexDirection: 'row',
            flexWrap: 'wrap',
            marginTop: '0.5rem',
          }}
        >
          {otherFilesItems.map((file, index) => (
            <NormalAttachment
              key={`${(file as Record<string, unknown>)?.uuid ?? `file_${index}`}`}
              attachment={file}
              onRemoveAttachment={onRemoveAttachment as any}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Renders a single image attachment card that opens the image preview modal
 * when clicked.
 */
function ImageAttachmentCard({
  attachment,
  onRemoveAttachment,
}: {
  readonly attachment: Attachment;
  readonly onRemoveAttachment?: (fileName: string, fromStorage: boolean) => void;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const fileName = getAttachmentName(attachment);
  const imageSrc = getAttachmentImageSource(attachment);

  return (
    <>
      <Box
        component="img"
        src={imageSrc ?? ''}
        alt={fileName}
        sx={{
          maxWidth: '16.25rem',
          maxHeight: '12rem',
          objectFit: 'contain',
          // eslint-disable-next-line elitea/ad-hoc-radius — image card border radius
          borderRadius: '0.5rem',
          cursor: 'pointer',
          border: '1px solid',
          borderColor: 'divider',
        }}
        onClick={() => setIsOpen(true)}
        data-testid="chat-image-attachment"
        data-name={fileName}
      />
      {isOpen && (
        <ViewImageAttachmentModal
          open={true}
          onClose={() => setIsOpen(false)}
          attachment={attachment}
          onRemoveAttachment={onRemoveAttachment as any}
        />
      )}
    </>
  );
}

/**
 * Returns `true` when `attachment` is an image file.
 *
 * Ported from `apps/elitea-ui/src/common/utils.jsx:isImageFile` — checks the
 * MIME type against the known image set.
 */
function isImageFile(attachment: Attachment): boolean {
  const det = attachment as Record<string, unknown>;
  const itemDet = det?.item_details as Record<string, unknown> | undefined;
  const t = itemDet?.attachment_type || det?.type;
  if (!t) return false;
  return (t as string).startsWith('image/');
}

/**
 * Returns the display name for an attachment.
 *
 * Ported from `entities/attachment/lib/attachment.helpers.js:getAttachmentName`.
 */
function getAttachmentName(attachment: Attachment): string {
  const det = attachment as Record<string, unknown>;
  const itemDet = det?.item_details as Record<string, unknown> | undefined;
  return (itemDet?.filepath as string) ||
    (itemDet?.name as string) ||
    (det?.name as string) ||
    '';
}
