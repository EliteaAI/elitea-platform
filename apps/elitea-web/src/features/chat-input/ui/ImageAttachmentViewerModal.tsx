import type { MouseEvent, ReactNode } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { ImportIcon } from '@/shared/ui/icons/import-icon';
import { ExpandedViewerModal } from '@/shared/ui/ExpandedViewerModal';

/**
 * The full-size image viewer opened from `ImageAttachment.tsx`'s thumbnail.
 * The old app's `ViewImageAttachmentModal`
 * (`@/components/Chat/ViewImageAttachmentModal`) has no port anywhere in
 * this app — per this unit's own brief, this is a local, deliberately
 * scoped-down rebuild on top of `shared/ui`'s already-built
 * `ExpandedViewerModal` (unit S1-H) rather than a from-scratch bespoke
 * `Dialog`, "don't over-engineer."
 *
 * Two disclosed simplifications versus the baseline, both intentional:
 *  - Escape-to-close: the baseline hand-rolled a `document.addEventListener
 *    ('keydown', …)` effect for this. `ExpandedViewerModal` -> `BaseModal`
 *    -> MUI `Dialog` already closes on Escape natively (`Dialog`'s own
 *    `onClose` fires on `escapeKeyDown` with no extra wiring) — reproducing
 *    the baseline's hand-rolled listener on top of that would double-invoke
 *    `onClose`. Composition already satisfies the requirement; no local
 *    effect is added.
 *  - No re-fetch of the ORIGINAL full-resolution file on open (baseline:
 *    `fetchArtifactBlobUrl` + a blob-URL-lifecycle effect). This viewer
 *    reuses the SAME resolved `imageSource` the thumbnail already computed
 *    (`getImageSource`) instead — real, disclosed scope cut: for a
 *    filepath-backed attachment the baseline shows a freshly-fetched
 *    original where this shows the same thumbnail/base64/object-URL source
 *    already on screen. Not enumerated in this unit's own required-scope
 *    list; adding a second network fetch + blob-URL cleanup effect here
 *    would be exactly the over-engineering the brief warns against for a
 *    component with no real caller yet.
 */
export interface ImageAttachmentViewerModalProps {
  readonly open: boolean;
  readonly imageSource: string;
  readonly attachmentName: string;
  readonly onClose: () => void;
  readonly onDownload: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onRequestDelete: (event: MouseEvent<HTMLButtonElement>) => void;
}

function imageSx(theme: Theme) {
  return {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: 'contain' as const,
    background: theme.vars.palette.background.tabPanel,
  };
}

export function ImageAttachmentViewerModal({
  open,
  imageSource,
  attachmentName,
  onClose,
  onDownload,
  onRequestDelete,
}: ImageAttachmentViewerModalProps): ReactNode {
  const downloadLabel = t('chatInput.imageAttachment.downloadAriaLabel', 'Download image');
  const removeLabel = t('chatInput.imageAttachment.removeAriaLabel', 'Remove attachment');

  return (
    <ExpandedViewerModal
      open={open}
      onClose={onClose}
      title={attachmentName}
      header={{
        customButtons: (
          <>
            <IconButton
              aria-label={downloadLabel}
              size="small"
              onClick={onDownload}
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
              onClick={onRequestDelete}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </>
        ),
      }}
      content={
        <Box
          component="img"
          src={imageSource}
          alt={attachmentName}
          sx={imageSx}
        />
      }
    />
  );
}
