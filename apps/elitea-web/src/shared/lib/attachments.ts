/**
 * Attachment size/count limits ported from
 * apps/elitea-ui/src/common/constants.js:1059-1065 (unit S3, spec §9.3).
 */
export const ATTACHMENT_LIMITS = {
  MAX_ATTACHMENTS: 10,
  /** 150MB in bytes. */
  MAX_TOTAL_SIZE: 150 * 1024 * 1024,
  /** 150MB in bytes, only one file. */
  DEFAULT_MAX_FILE_SIZE: 150 * 1024 * 1024,
  MAX_IMAGE_ATTACHMENTS: 10,
  /** 5MB in bytes, per image file (excluding SVG). */
  MAX_IMAGE_FILE_SIZE: 5 * 1024 * 1024,
} as const;

/** SVG gets the default (non-image) size cap, not `MAX_IMAGE_FILE_SIZE` — matches this constant's own doc comment ("excluding SVG"). Not exported — only `validateAttachmentFiles` below reads it today; promote if a second caller needs it directly. */
function isImageFile(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

/** Not exported — only `validateAttachmentFiles` below reads it today; promote if a second caller needs it directly. */
function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

export interface RemainingAttachmentCapacity {
  readonly remainingAttachments: number;
  readonly isAtMaxCapacity: boolean;
  readonly isAtMaxSize: boolean;
}

export function getRemainingAttachmentCapacity(
  attachments: readonly File[],
  limits: Pick<typeof ATTACHMENT_LIMITS, 'MAX_ATTACHMENTS' | 'MAX_TOTAL_SIZE'> = ATTACHMENT_LIMITS,
): RemainingAttachmentCapacity {
  const totalSize = attachments.reduce((sum, file) => sum + file.size, 0);
  return {
    remainingAttachments: Math.max(0, limits.MAX_ATTACHMENTS - attachments.length),
    isAtMaxCapacity: attachments.length >= limits.MAX_ATTACHMENTS,
    isAtMaxSize: totalSize >= limits.MAX_TOTAL_SIZE,
  };
}

export interface AttachmentValidationResult {
  readonly validFiles: readonly File[];
  /** One human-readable message per rejected file/limit, in the order encountered. */
  readonly errors: readonly string[];
}

/**
 * Validates newly-picked files against `ATTACHMENT_LIMITS` and whatever is
 * already attached: total count, total size, and per-file size (a lower cap
 * for images). New code, not a verbatim port — no `validateAttachmentFiles`
 * equivalent exists anywhere in this codebase yet (checked `entities/
 * attachment`, `shared/lib`; confirmed empty). Baseline
 * `common/attachmentValidationUtils.js`'s version ALSO validates file TYPE
 * against a dynamic backend allow-list (`useAllowedFileTypes`/
 * `useAllowedExtensions`) — no such data source exists anywhere in this
 * codebase yet either (no `useFileTypes` port), so type/extension
 * validation is a disclosed gap here, not silently invented.
 */
export function validateAttachmentFiles(
  files: readonly File[],
  existingAttachments: readonly File[],
  limits: typeof ATTACHMENT_LIMITS = ATTACHMENT_LIMITS,
): AttachmentValidationResult {
  const remainingSlots = Math.max(0, limits.MAX_ATTACHMENTS - existingAttachments.length);
  if (remainingSlots === 0) {
    return { validFiles: [], errors: [`You've reached the ${limits.MAX_ATTACHMENTS}-file limit.`] };
  }

  const errors: string[] = [];
  const validFiles: File[] = [];
  let imageCount = existingAttachments.filter(isImageFile).length;
  let totalSize = existingAttachments.reduce((sum, file) => sum + file.size, 0);

  for (const file of files) {
    if (validFiles.length >= remainingSlots) {
      errors.push(
        `You've reached the ${limits.MAX_ATTACHMENTS}-file limit. Only the first ${limits.MAX_ATTACHMENTS} will be processed.`,
      );
      break;
    }

    const isImage = isImageFile(file);
    const maxFileSize = isImage ? limits.MAX_IMAGE_FILE_SIZE : limits.DEFAULT_MAX_FILE_SIZE;
    if (file.size > maxFileSize) {
      errors.push(`"${file.name}" exceeds the ${formatFileSize(maxFileSize)} limit.`);
      continue;
    }

    if (isImage && imageCount >= limits.MAX_IMAGE_ATTACHMENTS) {
      errors.push(`Maximum ${limits.MAX_IMAGE_ATTACHMENTS} image attachments allowed.`);
      continue;
    }

    if (totalSize + file.size > limits.MAX_TOTAL_SIZE) {
      errors.push(`Total size limit of ${formatFileSize(limits.MAX_TOTAL_SIZE)} would be exceeded.`);
      continue;
    }

    validFiles.push(file);
    totalSize += file.size;
    if (isImage) imageCount += 1;
  }

  return { validFiles, errors };
}
