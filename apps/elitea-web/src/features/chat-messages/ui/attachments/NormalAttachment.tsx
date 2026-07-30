/**
 * ui/attachments/NormalAttachment.tsx — file attachment card for chat messages
 * (non-image files), ported from
 * `apps/elitea-ui/src/components/Chat/NormalAttachment.jsx` (C4 batch).
 *
 * Renders a compact card for a normal (non-image) file attachment, with name,
 * download button, preview button (when enabled), and a remove button that
 * opens a confirmation modal before the caller-supplied `onRemoveAttachment`
 * fires.
 */
import { useCallback, useState } from 'react';

import { Box, IconButton, Typography } from '@mui/material';

import Tooltip from '@mui/material/Tooltip';

import type { Attachment } from '@/entities/attachment/model/types';
import { getAttachmentName } from '@/entities/attachment/model/selectors';

const IconButtonAny = IconButton as any;

import type { NormalAttachmentArtifactData } from './types';

export interface NormalAttachmentProps {
  /** The attachment to render. */
  readonly attachment?: Attachment;
  /** Called when the user confirms removal — `fileName` is the display name, `fromStorage` whether to also delete from artifact storage. */
  readonly onRemoveAttachment?: (fileName: string, fromStorage: boolean) => void;
  /** Additional MUI sx overrides for the root card. */
  readonly sx?: Record<string, unknown>;
  /** When true, show a preview button in the action row. */
  readonly preview?: boolean;
  /** Called when the user taps the preview button — receives the artifact data shape. */
  readonly onOpenArtifactPreview?: (artifact: NormalAttachmentArtifactData) => void;
}

/**
 * Renders a normal (non-image) file attachment card inside a chat message.
 *
 * Matches the baseline `NormalAttachment.jsx` visual and interaction model:
 * compact card with the file name truncated with ellipsis, download and remove
 * actions on hover, optional preview, and a confirm-dialog before removal.
 */
export function NormalAttachment({
  attachment,
  onRemoveAttachment,
  sx = {},
  preview = false,
  onOpenArtifactPreview,
}: NormalAttachmentProps): React.ReactElement | null {
  const attachmentName = getAttachmentName(attachment ?? {} as Attachment);

  // Don't render if no valid attachment name (baseline: `!attachmentName` early return)
  if (!attachmentName) return null;

  const [isHovering, setIsHovering] = useState(false);
  const [openAlert, setOpenAlert] = useState(false);
  const [needToRemoveFromStorage, setNeedToRemoveFromStorage] = useState(false);

  const onClickRemove = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      setOpenAlert(true);
    },
    [],
  );

  const onClickDownload = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      // TODO: download implementation (S6 upload/download)
      // Baseline: downloadAttachmentFile / downloadFileFromArtifact path resolution
    },
    [],
  );

  const onPreviewFile = useCallback(() => {
    const artifact = {
      filepath: '',
      id: attachmentName,
      isUploading: false,
      modified: new Date().toISOString(),
      name: attachmentName,
      type: ((attachment as Record<string, unknown>)?.item_details as Record<string, unknown>)?.attachment_type as string | undefined,
      bucket: ((attachment as Record<string, unknown>)?.item_details as Record<string, unknown>)?.bucket as string | undefined,
    } as unknown as NormalAttachmentArtifactData;
    onOpenArtifactPreview?.(artifact);
  }, [attachment, attachmentName, onOpenArtifactPreview]);

  const onCloseAlert = useCallback((event?: React.MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    setOpenAlert(false);
  }, []);

  const onConfirmDelete = useCallback(
    (event?: React.MouseEvent<HTMLElement>) => {
      event?.stopPropagation();
      onRemoveAttachment?.(attachmentName, needToRemoveFromStorage);
      setOpenAlert(false);
    },
    [attachmentName, needToRemoveFromStorage, onRemoveAttachment],
  );

  return (
    <>
      <Box
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        sx={(theme) => ({
          display: 'flex',
          width: '12.125rem',
          height: '2.25rem',
          borderRadius: '0.5rem',
          overflow: 'hidden',
          position: 'relative',
          gap: '0.75rem',
          padding: '0.375rem 0.75rem',
          alignItems: 'center',
          background: (theme as any)?.palette?.background?.button?.default,
          ...sx,
        })}
        data-testid="chat-artifact-file-card"
        data-name={attachmentName}
      >
        <Typography
          variant="bodyMedium"
          color="text.secondary"
          sx={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: 'normal',
          }}
        >
          {attachmentName}
        </Typography>
        <Box
          sx={{
            display: isHovering ? 'flex' : 'none',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '0.15rem',
          }}
        >
          {preview && (
            <Tooltip title="View/Edit file" placement="top">
              <IconButtonAny variant="elitea" color="tertiary" size="small" onClick={onPreviewFile} aria-label="Preview attachment">
                👁
              </IconButtonAny>
            </Tooltip>
          )}
          <IconButtonAny variant="elitea" color="tertiary" size="small" onClick={onClickDownload} aria-label="Download attachment">
            ↓
          </IconButtonAny>
          <IconButtonAny variant="elitea" color="tertiary" size="small" onClick={onClickRemove} aria-label="Remove attachment">
            ✕
          </IconButtonAny>
        </Box>
      </Box>

      {/* Confirmation modal — baseline: Modal.DeleteEntityModal */}
      {openAlert && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1300,
          }}
          onClick={onCloseAlert}
        >
          <Box
            sx={{
              backgroundColor: 'background.paper',
              borderRadius: '1rem',
              padding: '1.5rem',
              maxWidth: '34.5rem',
              width: '100%',
            }}
            onClick={(e: React.MouseEvent<HTMLElement>) => e.stopPropagation()}
          >
            <Typography variant="bodyMedium" sx={{ marginBottom: '1rem' }}>
              Are you sure you want to remove {attachmentName}?
            </Typography>
            <Box sx={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '-0.5rem' }}>
              <Box
                component="input"
                type="checkbox"
                checked={needToRemoveFromStorage}
                onChange={(e) => setNeedToRemoveFromStorage(e.target.checked)}
                sx={{ marginTop: '0.3125rem' }}
              />
              <Typography variant="bodyMedium" color="text.secondary">
                Also delete from attachment storage
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <IconButtonAny size="small" onClick={onCloseAlert}>Cancel</IconButtonAny>
              <IconButtonAny variant="elitea" color="primary" size="small" onClick={onConfirmDelete}>Remove</IconButtonAny>
            </Box>
          </Box>
        </Box>
      )}
    </>
  );
}
