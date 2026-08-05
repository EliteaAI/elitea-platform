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

import { downloadAttachmentFromArtifact, downloadAttachmentImage } from '@/entities/attachment';
import type { Attachment } from '@/entities/attachment/model/types';
import { getAttachmentName, getImageSource } from '@/entities/attachment/model/selectors';
import { fetchArtifactBlob } from '@/shared/api/artifacts';
import { getConfig } from '@/shared/config';

import { planAttachmentDownload, parseAttachmentFilepath } from './attachmentDownload.helpers';

const IconButtonAny = IconButton as React.ComponentType<
  React.ComponentProps<typeof IconButton> & { variant?: string }
>;

export interface ViewImageAttachmentModalProps {
  /** Whether the modal is currently open. */
  readonly open: boolean;
  /** Fired when the modal closes (close button, overlay click, Escape). */
  readonly onClose: () => void;
  /** The image attachment being displayed. */
  readonly attachment: Attachment;
  /** Called when the user confirms removal — `fileName` is the display name, `fromStorage` whether to also delete from artifact storage. */
  readonly onRemoveAttachment?: (fileName: string, fromStorage: boolean) => void;
  /** Required to fetch the full-resolution image and to download an artifact-storage-backed attachment. */
  readonly projectId?: string;
  /** Called with a human-readable message on download failure or image load failure. */
  readonly onError?: (message: string) => void;
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
  projectId,
  onError,
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
    if (!attachmentFilepath || attachmentBucket === '__undefined__' || projectId === undefined) return;

    const parsed = parseAttachmentFilepath(attachmentFilepath);
    if (parsed === null) return;

    const config = getConfig();
    if (config.status !== 'ok') return;

    let cancelled = false;
    const controller = new AbortController();
    void fetchArtifactBlob({
      baseUrl: config.config.vite_server_url,
      projectId,
      bucket: parsed.bucket,
      filePath: parsed.filename,
      signal: controller.signal,
    }).then((result) => {
      if (cancelled || !result.ok) return;
      const objectUrl = URL.createObjectURL(result.data);
      const currentUrl = blobUrlRef.current;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      blobUrlRef.current = objectUrl;
      setFullResSource(objectUrl);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, attachmentFilepath, attachmentBucket, projectId]);

  // Revoke blob URL on unmount — capture ref value in effect body so cleanup
  // never touches `.current` directly (react-hooks/exhaustive-deps rule).
  useEffect(() => {
    const currentUrl = blobUrlRef.current;
    return () => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
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

  const onClickDownload = (event: React.MouseEvent<HTMLElement>): void => {
    event.stopPropagation();
    const plan = planAttachmentDownload(attachment);
    const reportError = (message: string): void => onError?.(message);

    if (plan.kind === 'legacy-base64') {
      downloadAttachmentImage(attachment, reportError);
      return;
    }

    const config = getConfig();
    if (config.status !== 'ok' || projectId === undefined) {
      /* eslint-disable-next-line i18next/no-literal-string — passed to caller's onError, not rendered directly */
      reportError('Failed to download image from storage');
      return;
    }

    void downloadAttachmentFromArtifact(
      { baseUrl: config.config.vite_server_url, projectId, filepath: plan.filepath },
      reportError,
    );
  };

  const handleImageError = (): void => {
    /* eslint-disable-next-line i18next/no-literal-string — passed to caller's onError, not rendered directly */
    onError?.('Failed to load image');
  };

  return (
    <>
      <Dialog
        fullWidth
        open={open}
        onClose={onClose}
        onKeyDown={handleKeyDown}
        sx={{
          // eslint-disable-next-line elitea/no-mui-internal-selector, elitea/no-raw-color, elitea/ad-hoc-radius
          // — MUI dialog paper override via sx is the standard pattern; #fafafa is paper bg; 1rem is modal radius
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
              onClick={onClickDownload}
              // eslint-disable-next-line i18next/no-literal-string — aria-label is accessibility, not user-facing
              aria-label="Download image"
            >
              ↓
            </IconButtonAny>
            {/* eslint-disable-next-line i18next/no-literal-string — icon-only action button */}
            <IconButtonAny
              variant="elitea"
              color="secondary"
              size="small"
              onClick={onClickRemove}
              // eslint-disable-next-line i18next/no-literal-string — aria-label is accessibility, not user-facing
              aria-label="Remove attachment"
            >
              ✕
            </IconButtonAny>
            {/* eslint-disable-next-line i18next/no-literal-string — icon-only action button */}
            <IconButtonAny
              variant="elitea"
              color="secondary"
              size="small"
              onClick={onClose}
              // eslint-disable-next-line i18next/no-literal-string — aria-label is accessibility, not user-facing
              aria-label="Close modal"
            >
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
            onError={handleImageError}
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
            // eslint-disable-next-line elitea/no-raw-color — overlay opacity, not a theme colour
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
              // eslint-disable-next-line elitea/ad-hoc-radius — rounded corners for modal
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
              {/* eslint-disable-next-line i18next/no-literal-string — confirmation dialog text */}
              <Typography variant="bodyMedium" color="text.secondary">
                Also delete from attachment storage
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
              <IconButtonAny size="small" onClick={onCloseAlert}>
                {/* eslint-disable-next-line i18next/no-literal-string — confirmation button */}
                Cancel
              </IconButtonAny>
              <IconButtonAny variant="elitea" color="primary" size="small" onClick={onConfirmDelete}>
                {/* eslint-disable-next-line i18next/no-literal-string — confirmation button */}
                Remove
              </IconButtonAny>
            </Box>
          </Box>
        </Box>
      )}
    </>
  );
});

ViewImageAttachmentModal.displayName = 'ViewImageAttachmentModal';
