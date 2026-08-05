/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Attachment } from './model/types';
export {
  getAttachmentDisabledStatus,
  getAttachmentName,
  getImageSource,
  hasUnresolvedFilepath,
} from './model/selectors';
export type { DownloadAttachmentFromArtifactParams } from './lib/download';
export { downloadAttachmentFromArtifact, downloadAttachmentImage } from './lib/download';
