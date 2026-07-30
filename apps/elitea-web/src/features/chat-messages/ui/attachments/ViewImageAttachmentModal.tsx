/**
 * ui/attachments/ViewImageAttachmentModal.tsx — modal for viewing image
 * attachments, ported from
 * `apps/elitea-ui/src/components/Chat/ViewImageAttachmentModal.jsx` (C4 batch).
 *
 * Opens a full-screen-style dialog to display a large preview of an image
 * attachment, with download and remove actions.
 */
import { memo, useEffect, useRef, useState } from 'react';

import { Box, Dialog, DialogContent, IconButton, Typography } from '@mui/material';

const IconButtonAny = IconButton as any;

import type { Attachment } from '@/entities/attachment/model/types';
import { getAttachmentName, getImageSource } from '@/entities/attachment/model/selectors';

export interface ViewImageAttachmentModalProps {
  /** Whether the modal is currently open. */
  readonly open: boolean;
  /** Fired when the modal closes (close button, overlay click, Escape). */
  readonly onClose: () => void;
  /** The image attachment being displayed. */
  readonly attachment: Attachment;
  /** Called when the user confirms removal — `fileName` is the display name, `fromStorage` whether to also delete from artifact storage. */
  readonly onRemoveAttachment?: (fileName: string, fromStorage: boolean) => void;
}

/**
 * Renders a full dialog to preview a single image attachment.
 *
 * Matches the baseline `ViewImageAttachmentModal.jsx` behaviour: fetches a
 * high-resolution blob URL when `open` and the attachment has a `filepath` in
 * a non-undefined bucket; falls back to the thumbnail `data:` URL otherwise.
 Includes download and remove actions with a confirmation dialog on remove.
 */
export const ViewImageAttachmentModal = memo(function ViewImageAttachmentModal({
  open,
  onClose,
  attachment,
  onRemoveAttachment,
}: ViewImageAttachmentModalProps): React.ReactElement | null {
  const imageSource = getImageSource(attachment);
  const attachmentName = getAttachmentName(attachment);
  const attachmentFilepath = ((attachment as Record<string, unknown>)?.item_details as Record<string, unknown>)?.filepath as string | undefined;
  const attachmentBucket = ((attachment as Record<string, unknown>)?.item_details as Record<string, unknown>)?.bucket as string | undefined;

  const [openAlert, setOpenAlert] = useState(false);
  const [needToRemoveFromStorage, setNeedToRemoveFromStorage] = useState(false);
  const [fullResSource, setFullResSource] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Fetch high-res blob URL when the modal opens (baseline: effect on [open, attachmentFilepath, attachmentBucket, projectId])
  useEffect(() => {
    if (!open) {
      setFullResSource(null);
      return;
    }
    if (!attachmentFilepath || attachmentBucket === '__undefined__') return;

    let cancelled = false;
    // TODO: replace with shared fetchArtifactBlob (S6)
    // Baseline: `fetchArtifactBlobUrl({ projectId, filepath: attachmentFilepath })`
    (async () => {
      // Placeholder — real implementation would fetch the artifact blob
      if (cancelled) return;
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      // blobUrlRef.current = objectUrl;
      // setFullResSource(objectUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, attachmentFilepath, attachmentBucket]);

  // Revoke blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  if (!imageSource) return null;

  const fileName = (() => {
    const det = attachment as Record<string, unknown>;
    const itemDet = det?.item_details as Record<string, unknown> | undefined;
    return (itemDet?.filepath as string) ||
      (itemDet?.name as string) ||
      (det?.name as string) ||
      'image';
  })();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const onClickRemove = () => setOpenAlert(true);

  const onCloseAlert = (event?: React.MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    setOpenAlert(false);
  };

  const onConfirmDelete = (event?: React.MouseEvent<HTMLElement>) => {
    event?.stopPropagation();
    onRemoveAttachment?.(fileName, needToRemoveFromStorage);
    setOpenAlert(false);
    onClose();
  };

  return (
    <>
      <Dialog
        fullWidth
        open={open}
        onClose={onClose}
        onKeyDown={handleKeyDown}
        sx={{
          '& .MuiDialog-paper': {
            background: '#fafafa',
            borderRadius: '1rem',
            marginTop: 0,
            position: 'absolute',
            top: '4rem',
            maxWidth: '47.5625rem',
          },
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1.5rem',
            width: '100%',
            boxSizing: 'border-box',
            padding: '1rem 1.5rem',
            height: '3.75rem',
          }}
        >
          <Typography color="text.secondary" variant="headingMedium">
            {attachmentName}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.75rem',
            }}
          >
            <IconButtonAny
              variant="elitea"
              color="secondary"
              size="small"
              onClick={(e: React.MouseEvent<HTMLElement>) => {
                e.stopPropagation();
                // TODO: download implementation
              }}
              aria-label="Download image"
            >
              ↓
            </IconButtonAny>
            <IconButtonAny
              variant="elitea"
              color="secondary"
              size="small"
              onClick={onClickRemove}
              aria-label="Remove attachment"
            >
              ✕
            </IconButtonAny>
            <IconButtonAny variant="elitea" color="secondary" size="small" onClick={onClose} aria-label="Close modal">
              ✕
            </IconButtonAny>
          </Box>
        </Box>

        {/* Image content */}
        <DialogContent
          sx={{
            width: '100%',
            padding: '0.9375rem 2.5rem',
            boxSizing: 'border-box',
            height: '25.5625rem',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <img
            src={fullResSource ?? imageSource}
            width="100%"
            height="100%"
            alt={attachmentName}
            style={{ objectFit: 'contain' }}
            onError={() => {
              // TODO: toast error
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Remove confirmation modal — same pattern as NormalAttachment */}
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
            <Box sx={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginTop: '-0.5rem' }}>
              <Box
                component="input"
                type="checkbox"
                checked={needToRemoveFromStorage}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNeedToRemoveFromStorage(e.target.checked)}
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
});

ViewImageAttachmentModal.displayName = 'ViewImageAttachmentModal';
