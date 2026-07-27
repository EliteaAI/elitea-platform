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
