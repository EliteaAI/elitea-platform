import type { MouseEvent, ReactNode } from 'react';
import { useCallback, useState } from 'react';

import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';

import type { Attachment } from '@/entities/attachment';
import {
  downloadAttachmentFromArtifact,
  downloadAttachmentImage,
  getAttachmentName,
  getImageSource,
  hasUnresolvedFilepath,
} from '@/entities/attachment';
import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';
import { BaseCheckbox } from '@/shared/ui/BaseCheckbox';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';
import { ImportIcon } from '@/shared/ui/icons/import-icon';

import { ImageAttachmentViewerModal } from './ImageAttachmentViewerModal';
import { attachmentDeleteKey, planAttachmentDownload } from './imageAttachment.helpers';

const ACTIONS_CLASS = 'chat-input-image-attachment-actions';

/** @public */
export interface ImageAttachmentProps {
  readonly attachment: Attachment;
  /**
   * Fired on confirmed delete (matches the baseline's `onRemoveAttachment
   * (fileName, needToRemoveFromStorage)` exactly, including its call
   * shape). Widened to `fileName: string | undefined` versus the
   * baseline's implicitly-always-a-string signature — a DISCLOSED,
   * deliberately honest typing choice: `attachmentDeleteKey` can genuinely
   * resolve to `undefined` (e.g. a bare-string `Attachment` with no
   * `item_details`/`name` at all), and the baseline itself calls its
   * `onRemoveAttachment` unconditionally in that case too (no guard) — this
   * port reproduces that exact call-through rather than silently adding a
   * guard the baseline never had (§3.6 "reproduce documented behaviour").
   */
  readonly onRemoveAttachment?: (fileName: string | undefined, needToRemoveFromStorage: boolean) => void;
  readonly showThumbnail?: boolean;
  /**
   * `useSelectedProjectId()` (baseline: `hooks/useSelectedProject.jsx`) is
   * an explicit prop here, NOT an internal router-context read — matching
   * this slice's own established convention (`features/chat-input/api/
   * models.ts`'s explicit `projectId` param; `__tests__/testUtils.tsx`'s
   * documented "no router context here ... projectId etc. are always
   * explicit props/args", the same N4 convention `features/
   * chat-conversation-list` set). Only consumed by the artifact-storage
   * download branch (`planAttachmentDownload`'s `'artifact-storage'` case);
   * `undefined` degrades to `onError` being called instead of downloading.
   */
  readonly projectId?: string;
  /** Replaces the baseline's internal `useToast()` — no toast system exists anywhere in this app yet (same gap `ExportApplicationButton`/`DeleteApplicationButton` already document). Called for both download failures and `<img>` load failures. */
  readonly onError?: (message: string) => void;
  /** Seeds `data-testid` on the root container — the baseline's own `id` prop was destructured by `ImageAttachment.jsx` but never actually read by `ViewImageAttachmentModal` (dead pass-through); this replaces that dead prop with one that does something. */
  readonly id?: string;
}

function mainContainerSx(theme: Theme) {
  return {
    position: 'relative' as const,
    width: '100%',
    height: '9.125rem',
    overflow: 'hidden' as const,
    borderRadius: theme.vars.shape.radiusMd,
    background: theme.vars.palette.background.button.default,
    [`&:hover .${ACTIONS_CLASS}, &:focus-within .${ACTIONS_CLASS}`]: { visibility: 'visible' as const },
  };
}

const imageButtonSx = {
  display: 'block' as const,
  width: '100%',
  height: '100%',
  padding: 0,
};

const imageSx = {
  width: '100%',
  height: 'auto',
  maxHeight: '100%',
  objectFit: 'scale-down' as const,
  display: 'block' as const,
};

function pendingLabelSx(theme: Theme) {
  return {
    color: theme.vars.palette.text.secondary,
    textAlign: 'center' as const,
    padding: '0.5rem',
    wordBreak: 'break-word' as const,
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '90%',
    pointerEvents: 'none' as const,
  };
}

function actionsOverlaySx(theme: Theme) {
  return {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex' as const,
    alignItems: 'flex-end' as const,
    justifyContent: 'center' as const,
    padding: '0.5rem',
    gap: '0.75rem',
    background: theme.vars.palette.background.imageAttachment,
    visibility: 'hidden' as const,
  };
}

const extraContentBoxSx = {
  boxSizing: 'border-box' as const,
  display: 'flex' as const,
  flexDirection: 'row' as const,
  gap: '0.5rem',
  alignItems: 'flex-start' as const,
};

const checkboxSx = { padding: 0, marginTop: '0.3125rem' };

interface DeleteConfirmContentProps {
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}

function DeleteConfirmContent({ checked, onChange }: DeleteConfirmContentProps): ReactNode {
  return (
    <Box sx={extraContentBoxSx}>
      <BaseCheckbox
        checked={checked}
        sx={checkboxSx}
        onChange={(_, value) => onChange(value)}
      />
      <Typography
        variant="bodyMedium"
        color="text.secondary"
      >
        {t('chatInput.imageAttachment.alsoDeleteFromStorage', 'Also delete from attachment storage')}
      </Typography>
    </Box>
  );
}

/**
 * Thumbnail/pending-label + hover action overlay (download/remove) for a
 * single chat attachment, plus the full-size viewer and delete-confirmation
 * flows it opens. Full port of `apps/elitea-ui/src/[fsd]/features/chat/ui/
 * chat-attachment/ImageAttachment.jsx` (and its sibling `ViewImageAttachmentModal
 * .jsx`, folded in — see `./ImageAttachmentViewerModal.tsx`'s own doc
 * comment for that file's disclosed scope cuts).
 *
 * DISCLOSED DEVIATIONS FROM THE BASELINE:
 *  - Single delete-confirmation dialog, not two. The baseline renders
 *    `DeleteEntityModal` TWICE — once inside `ImageAttachment.jsx` itself
 *    (for the thumbnail's inline delete button) and once again inside
 *    `ViewImageAttachmentModal.jsx` (for the viewer's own delete button) —
 *    each with its OWN duplicated `needToRemoveFromStorage`/`openAlert`
 *    local state. Both routes now open the SAME dialog (`openDeleteConfirm`
 *    below), reachable from either the thumbnail overlay or the viewer's
 *    header button — one source of truth, not two copies of the same
 *    state that could theoretically drift.
 *  - a11y restructure of the hover-overlay: the baseline's whole action
 *    overlay `<div>` carried `onClick={toggleModal}` directly (a
 *    `jsx-a11y/no-static-element-interactions`/`click-events-have-key-
 *    events` violation, and — because it visually wraps the two `<button>`
 *    action elements — would also nest interactive elements). Restructured
 *    so a real `ButtonBase` (native `<button>`, real keyboard support)
 *    covers only the image/pending-label area and opens the viewer; the
 *    two action `IconButton`s are a SIBLING overlay, not a descendant of
 *    that button, so nothing nests. Same "real ButtonBase instead of a
 *    div with onClick" fix `CategoryItemCard.tsx`'s own doc comment
 *    documents for the identical class of defect.
 *  - `&:focus-within` added alongside `&:hover` to reveal the action
 *    overlay (baseline: hover-only). Without it, the two action buttons
 *    would be invisible AND (via `visibility: hidden`) genuinely
 *    unfocusable for a keyboard-only user tabbing through the thumbnail —
 *    same fix `ResizableCodeMirrorEditor.tsx` already established for its
 *    own hover-revealed expand action.
 */
export function ImageAttachment({
  attachment,
  onRemoveAttachment,
  showThumbnail = true,
  projectId,
  onError,
  id,
}: ImageAttachmentProps): ReactNode {
  const [openViewer, setOpenViewer] = useState(false);
  const [openDeleteConfirm, setOpenDeleteConfirm] = useState(false);
  const [alsoDeleteFromStorage, setAlsoDeleteFromStorage] = useState(false);

  const imageSource = getImageSource(attachment);
  const isPending = imageSource === null && hasUnresolvedFilepath(attachment);
  const attachmentName = getAttachmentName(attachment);
  const fileKey = attachmentDeleteKey(attachment);

  const toggleViewer = useCallback(() => setOpenViewer((prev) => !prev), []);

  const openDelete = useCallback((event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    setOpenDeleteConfirm(true);
  }, []);

  const closeDelete = useCallback(() => {
    setOpenDeleteConfirm(false);
  }, []);

  const confirmDelete = useCallback(() => {
    onRemoveAttachment?.(fileKey, alsoDeleteFromStorage);
    setOpenDeleteConfirm(false);
    setOpenViewer(false);
  }, [fileKey, alsoDeleteFromStorage, onRemoveAttachment]);

  const handleDownload = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const plan = planAttachmentDownload(attachment);
      const reportError = (message: string): void => onError?.(message);

      if (plan.kind === 'legacy-base64') {
        downloadAttachmentImage(attachment, reportError);
        return;
      }

      const config = getConfig();
      if (config.status !== 'ok' || projectId === undefined) {
        reportError(t('chatInput.imageAttachment.downloadUnavailable', 'Failed to download image from storage'));
        return;
      }

      void downloadAttachmentFromArtifact(
        { baseUrl: config.config.vite_server_url, projectId, filepath: plan.filepath },
        reportError,
      );
    },
    [attachment, projectId, onError],
  );

  const handleImageError = useCallback(() => {
    onError?.(t('chatInput.imageAttachment.loadError', 'Failed to load image'));
  }, [onError]);

  if (imageSource === null && !isPending) return null;

  const viewLabel = t('chatInput.imageAttachment.viewAriaLabel', 'View attachment');
  const downloadLabel = t('chatInput.imageAttachment.downloadAriaLabel', 'Download image');
  const removeLabel = t('chatInput.imageAttachment.removeAriaLabel', 'Remove attachment');

  return (
    <>
      <Box
        sx={mainContainerSx}
        data-testid={id}
      >
        <ButtonBase
          onClick={toggleViewer}
          aria-label={viewLabel}
          sx={imageButtonSx}
        >
          {showThumbnail && imageSource !== null ? (
            <Box
              component="img"
              src={imageSource}
              alt={attachmentName}
              sx={imageSx}
              onError={handleImageError}
            />
          ) : (
            imageSource === null && (
              <Typography
                variant="bodySmall"
                sx={pendingLabelSx}
              >
                {attachmentName}
              </Typography>
            )
          )}
        </ButtonBase>
        <Box
          className={ACTIONS_CLASS}
          sx={actionsOverlaySx}
        >
          <IconButton
            aria-label={downloadLabel}
            size="small"
            onClick={handleDownload}
          >
            <SvgIcon
              component={ImportIcon}
              inheritViewBox
              fontSize="small"
            />
          </IconButton>
          <IconButton
            aria-label={removeLabel}
            size="small"
            onClick={openDelete}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <ImageAttachmentViewerModal
        open={openViewer && imageSource !== null}
        imageSource={imageSource ?? ''}
        attachmentName={attachmentName}
        onClose={toggleViewer}
        onDownload={handleDownload}
        onRequestDelete={openDelete}
      />
      <DeleteEntityModal
        open={openDeleteConfirm}
        onClose={closeDelete}
        onConfirm={confirmDelete}
        shouldRequestInputName={false}
        content={{
          extra: (
            <DeleteConfirmContent
              checked={alsoDeleteFromStorage}
              onChange={setAlsoDeleteFromStorage}
            />
          ),
        }}
        {...(fileKey !== undefined ? { name: fileKey } : {})}
      />
    </>
  );
}
