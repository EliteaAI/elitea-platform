/**
 * Pure download-routing decision for the attachments/ card components —
 * this feature's own copy of `features/chat-input/ui/imageAttachment.helpers.ts`'s
 * `planAttachmentDownload`. Duplicated rather than imported: chat-messages
 * must not import from a sibling feature (no-sideways-features), and
 * `entities/attachment` does not model `item_details.bucket` (deliberately —
 * see that slice's own `model/types.ts` doc comment), so this decision
 * cannot live there either.
 */
import type { Attachment } from '@/entities/attachment';

/** The backend's own sentinel for "no real bucket assigned" — a `filepath` under this sentinel bucket still routes to the legacy/base64 download branch. */
const UNASSIGNED_BUCKET_SENTINEL = '__undefined__';

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

interface ArtifactStorageDownload {
  readonly kind: 'artifact-storage';
  readonly filepath: string;
}

interface LegacyBase64Download {
  readonly kind: 'legacy-base64';
}

export type AttachmentDownloadPlan = ArtifactStorageDownload | LegacyBase64Download;

/**
 * `item_details.bucket` is read here even though `AttachmentItemDetails`
 * does not model it — deliberately, per that slice's own `model/types.ts`
 * doc comment. No cast is needed to read it: every field this interface
 * declares is optional, so `AttachmentItemDetails` (which structurally lacks
 * `bucket`) is already assignable to it, same reasoning
 * `imageAttachment.helpers.ts`'s own `StoredItemDetails` doc comment gives.
 */
interface StoredItemDetails {
  readonly filepath?: string;
  readonly bucket?: string;
}

/**
 * A real, non-sentinel `filepath` routes to artifact storage
 * (`downloadAttachmentFromArtifact`); everything else (no filepath, or the
 * `__undefined__` sentinel bucket) routes to the legacy base64/File branch
 * (`downloadAttachmentImage`).
 */
export function planAttachmentDownload(attachment: Attachment): AttachmentDownloadPlan {
  if (typeof attachment === 'string' || attachment instanceof File) return { kind: 'legacy-base64' };
  const details: StoredItemDetails | undefined = attachment.item_details;
  const filepath = nonEmpty(details?.filepath);
  if (filepath !== undefined && details?.bucket !== UNASSIGNED_BUCKET_SENTINEL) {
    return { kind: 'artifact-storage', filepath };
  }
  return { kind: 'legacy-base64' };
}

/** `/{bucket}/{filename}` -> `{bucket, filename}` — old app: `parseFilepath`, common/utils.jsx:359-370. Mirrors the identically-named private helper in `entities/attachment/lib/download.ts` (not exported from there — duplicated here rather than reached into, same no-sideways-features-style boundary reasoning as `planAttachmentDownload` above). Returns `null` on malformed input instead of throwing. */
export function parseAttachmentFilepath(filepath: string): { readonly bucket: string; readonly filename: string } | null {
  if (!filepath.startsWith('/')) return null;
  const parts = filepath.slice(1).split('/');
  const bucket = parts[0];
  const filename = parts.slice(1).join('/');
  if (bucket === undefined || bucket === '' || filename === '') return null;
  return { bucket, filename };
}
