import { memo, forwardRef, useImperativeHandle, useRef, useCallback, useMemo, useState } from 'react';

import AttachFileIcon from '@mui/icons-material/AttachFile';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { ATTACHMENT_LIMITS, getRemainingAttachmentCapacity, validateAttachmentFiles } from '@/shared/lib/attachments';

/**
 * Chat button primitive: AttachmentButton
 *
 * Renders an icon button that opens a file-picker dialog. Supports drag-and-
 * drop via the `onDrop` imperative handle (wired by the composition root that
 * also injects `attachmentButtonRef` into `NewChatInput`).
 *
 * Every newly-picked/dropped file is validated via `validateAttachmentFiles`
 * (`shared/lib/attachments.ts` — count/size/per-image-size limits from
 * `ATTACHMENT_LIMITS`); rejected files are dropped and reported through
 * `onError`, not silently attached. `limits` stays a loose
 * `Record<string, number>` (unchanged shape, still accepted from
 * `PlusChatButton`'s own pass-through prop of the same name/type) — real
 * `ATTACHMENT_LIMITS` values are the base, and any matching keys the caller
 * supplies override them (`{ ...ATTACHMENT_LIMITS, ...limits }`); unrelated
 * keys are ignored rather than rejected, since nothing in this codebase
 * currently supplies validated `limits` data.
 *
 * `onError` (not a toast) — no toast/snackbar primitive exists yet in
 * `shared/ui` (established gap, see `features/mcps/model/useMcpAuthModal.ts`'s
 * identical disclosure); the caller decides how to surface the message
 * until one lands.
 *
 * `disabled` factors in every signal this component can actually observe
 * today (`disableAttachments`/in-flight processing/at-capacity/at-max-size).
 * Baseline additionally factors in `isLoading`/`noFileTypesAvailable` from a
 * dynamic backend file-types query (`useFileTypes`/`useAllowedExtensions`) —
 * no such hook exists anywhere in this codebase yet (disclosed gap, not
 * invented here).
 *
 * Prop contract (injected by the composition root through `slots.attachmentButton`):
 *   - `onAttachFiles`  — called with the validated, accepted File(s)
 *   - `disableAttachments` — disables the button / hides file picker
 *   - `attachments` — current list of attached files (used for count/size limit checks)
 *   - `limits` — optional overrides merged onto `ATTACHMENT_LIMITS`
 *   - `onError` — called with a human-readable message when files are rejected
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
  onError?: (message: string) => void;
}

export const AttachmentButton = memo(
  forwardRef<AttachmentButtonHandle, AttachmentButtonProps>(
    ({ disableAttachments = false, attachments = [], onAttachFiles, limits, onError }, ref) => {
      const fileInputRef = useRef<HTMLInputElement>(null);
      const [isProcessing, setIsProcessing] = useState(false);

      const effectiveLimits = useMemo<typeof ATTACHMENT_LIMITS>(() => ({ ...ATTACHMENT_LIMITS, ...limits }), [limits]);

      const processFiles = useCallback(
        (files: readonly File[]) => {
          if (files.length === 0) return;
          setIsProcessing(true);
          try {
            const { validFiles, errors } = validateAttachmentFiles(files, attachments, effectiveLimits);
            if (errors.length > 0) onError?.(errors.join('\n'));
            if (validFiles.length > 0) onAttachFiles?.(validFiles);
          } finally {
            setIsProcessing(false);
          }
        },
        [attachments, effectiveLimits, onAttachFiles, onError],
      );

      useImperativeHandle(
        ref,
        () => ({
          onDrop: (event: { dataTransfer: { files: readonly File[] }; preventDefault(): void }) => {
            event.preventDefault();
            if (disableAttachments) return;
            processFiles(Array.from(event.dataTransfer.files));
          },
        }),
        [processFiles, disableAttachments],
      );

      const capacity = getRemainingAttachmentCapacity(attachments, effectiveLimits);
      const isDisabled = disableAttachments || isProcessing || capacity.isAtMaxCapacity || capacity.isAtMaxSize;

      const handleButtonClick = useCallback(() => {
        if (capacity.isAtMaxCapacity) {
          onError?.(
            t('widgets.chat.attachmentButton.fileLimitReachedError', "You've reached the {{max}}-file limit.", {
              max: effectiveLimits.MAX_ATTACHMENTS,
            }),
          );
          return;
        }
        fileInputRef.current?.click();
      }, [capacity.isAtMaxCapacity, effectiveLimits.MAX_ATTACHMENTS, onError]);

      const handleFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            processFiles(Array.from(files));
          }
          // Reset so the same file can be re-selected if needed
          e.target.value = '';
        },
        [processFiles],
      );

      const tooltipText = isProcessing
        ? t('widgets.chat.attachmentButton.processingTooltip', 'Processing...')
        : capacity.isAtMaxCapacity
          ? t('widgets.chat.attachmentButton.maxAttachmentsTooltip', 'Max {{max}} attachments', {
              max: effectiveLimits.MAX_ATTACHMENTS,
            })
          : capacity.isAtMaxSize
            ? t('widgets.chat.attachmentButton.sizeLimitTooltip', 'Size limit reached')
            : capacity.remainingAttachments === 1
              ? t('widgets.chat.attachmentButton.oneFileLeftTooltip', '{{count}} file left', {
                  count: capacity.remainingAttachments,
                })
              : t('widgets.chat.attachmentButton.filesLeftTooltip', '{{count}} files left', {
                  count: capacity.remainingAttachments,
                });

      return (
        <>
          <Tooltip title={tooltipText} placement="top">
            <Box component="span">
              <IconButton
                color="secondary"
                aria-label={t('widgets.chat.attachmentButton.ariaLabel', 'attach files')}
                disabled={isDisabled}
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
            disabled={isDisabled}
            onChange={handleFileChange}
            aria-hidden="true"
          />
        </>
      );
    },
  ),
);

AttachmentButton.displayName = 'AttachmentButton';
