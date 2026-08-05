import type { MouseEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import type { Theme } from '@mui/material/styles';

import { fetchArtifactBlob } from '@/shared/api/artifacts';
import { getConfig } from '@/shared/config';
import { t } from '@/shared/i18n';
import { ImportIcon } from '@/shared/ui/icons/import-icon';
import { ExpandedViewerModal } from '@/shared/ui/ExpandedViewerModal';

import { parseAttachmentFilepath } from './imageAttachment.helpers';

/**
 * The full-size image viewer opened from `ImageAttachment.tsx`'s thumbnail.
 * The old app's `ViewImageAttachmentModal`
 * (`@/components/Chat/ViewImageAttachmentModal`) has no port anywhere in
 * this app — per this unit's own brief, this is a local, deliberately
 * scoped-down rebuild on top of `shared/ui`'s already-built
 * `ExpandedViewerModal` (unit S1-H) rather than a from-scratch bespoke
 * `Dialog`, "don't over-engineer."
 *
 * One disclosed simplification versus the baseline:
 *  - Escape-to-close: the baseline hand-rolled a `document.addEventListener
 *    ('keydown', …)` effect for this. `ExpandedViewerModal` -> `BaseModal`
 *    -> MUI `Dialog` already closes on Escape natively (`Dialog`'s own
 *    `onClose` fires on `escapeKeyDown` with no extra wiring) — reproducing
 *    the baseline's hand-rolled listener on top of that would double-invoke
 *    `onClose`. Composition already satisfies the requirement; no local
 *    effect is added.
 *
 * Full parity with the baseline's re-fetch of the ORIGINAL full-resolution
 * file on open (baseline: `fetchArtifactBlobUrl` + a blob-URL-lifecycle
 * effect): when `artifactFilepath` is set (i.e. `imageAttachment.helpers.ts`'s
 * `planAttachmentDownload` classified this attachment as
 * `'artifact-storage'`) and `projectId` is known, this fetches the real
 * original via the same `fetchArtifactBlob` primitive the sibling
 * `features/chat-messages/ui/attachments/ViewImageAttachmentModal.tsx`
 * already uses for the identical baseline behaviour, and swaps `<img
 * src>` from the thumbnail `imageSource` to the freshly-fetched blob URL
 * once it resolves, revoking the previous blob URL on replacement/unmount.
 */
export interface ImageAttachmentViewerModalProps {
  readonly open: boolean;
  readonly imageSource: string;
  readonly attachmentName: string;
  /**
   * The `filepath` from `planAttachmentDownload`'s `'artifact-storage'`
   * branch, or `undefined` when the attachment has no real backing filepath
   * (legacy base64 / File) — mirrors the baseline's own `attachment.
   * item_details.filepath && bucket !== '__undefined__'` gate. `undefined`
   * skips the full-resolution fetch and the modal just shows `imageSource`.
   */
  readonly artifactFilepath?: string;
  /** Required (together with `artifactFilepath`) to fetch the full-resolution original from artifact storage. */
  readonly projectId?: string;
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
  artifactFilepath,
  projectId,
  onClose,
  onDownload,
  onRequestDelete,
}: ImageAttachmentViewerModalProps): ReactNode {
  const downloadLabel = t('chatInput.imageAttachment.downloadAriaLabel', 'Download image');
  const removeLabel = t('chatInput.imageAttachment.removeAriaLabel', 'Remove attachment');

  const [fullResSource, setFullResSource] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Fetch the original full-resolution file when the viewer opens on a
  // filepath-backed attachment — baseline: ViewImageAttachmentModal.jsx's
  // `fetchArtifactBlobUrl` effect. Deliberately keyed on the primitive
  // `artifactFilepath`/`projectId` props (not a whole `attachment`/plan
  // object) so an unrelated parent re-render while the modal stays open
  // does not re-trigger the fetch.
  useEffect(() => {
    if (!open) {
      setFullResSource(null);
      return;
    }
    if (artifactFilepath === undefined || projectId === undefined) return;

    const parsed = parseAttachmentFilepath(artifactFilepath);
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
      const previousUrl = blobUrlRef.current;
      if (previousUrl !== null) URL.revokeObjectURL(previousUrl);
      blobUrlRef.current = objectUrl;
      setFullResSource(objectUrl);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, artifactFilepath, projectId]);

  // Revoke the last blob URL on unmount — captures the ref's value in the
  // effect body so cleanup never reads `.current` directly (react-hooks/
  // exhaustive-deps).
  useEffect(() => {
    return () => {
      const currentUrl = blobUrlRef.current;
      if (currentUrl !== null) URL.revokeObjectURL(currentUrl);
    };
  }, []);

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
          src={fullResSource ?? imageSource}
          alt={attachmentName}
          sx={imageSx}
        />
      }
    />
  );
}
