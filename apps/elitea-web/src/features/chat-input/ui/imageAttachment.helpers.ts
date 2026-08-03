import type { Attachment } from '@/entities/attachment';

/**
 * Pure helpers for `ImageAttachment.tsx`, ported from
 * `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-attachment/ImageAttachment.jsx`.
 *
 * `item_details.bucket` is read here even though entities/attachment's own
 * `AttachmentItemDetails` type does not model it — deliberately, per that
 * slice's own model/types.ts doc comment: "`item_details.bucket` ... is
 * deliberately NOT modeled here — it belongs to that sibling cluster's own
 * prop/param, not to any function this slice exports". This IS that
 * cluster. `StoredItemDetails` below is the narrow, real wire shape read
 * here; `storedItemDetails` is the one place that gap is bridged (see its
 * own doc comment for why no cast is needed there).
 */

interface StoredItemDetails {
  readonly name?: string;
  readonly filepath?: string;
  readonly bucket?: string;
}

function storedItemDetails(attachment: Attachment): StoredItemDetails | undefined {
  if (typeof attachment === 'string' || attachment instanceof File) return undefined;
  // No cast needed here (would be flagged as unnecessary by tsgolint):
  // every field `StoredItemDetails` declares is optional, so entities/
  // attachment's `AttachmentItemDetails` — which structurally lacks
  // `bucket` — is already assignable to it without one. See the module doc
  // comment for why `bucket` is read here at all.
  return attachment.item_details;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

/**
 * ImageAttachment.jsx:31-33's `fileName` — the RAW delete-key handed to
 * `onRemoveAttachment`, NOT a display label. Deliberately different from
 * entities/attachment's `getAttachmentName` (the display-label port): that
 * function prioritises `item_details.name` first and reduces a `filepath`
 * to its basename; this one prioritises the FULL `filepath` first,
 * matching the baseline's own `||` fallback chain exactly (`item_details
 * ?.filepath || item_details?.name || attachment.name`).
 */
export function attachmentDeleteKey(attachment: Attachment): string | undefined {
  if (typeof attachment === 'string') return undefined;
  if (attachment instanceof File) return nonEmpty(attachment.name);
  const details = storedItemDetails(attachment);
  return nonEmpty(details?.filepath) ?? nonEmpty(details?.name) ?? nonEmpty(attachment.name);
}

/** The backend's own sentinel for "no real bucket assigned" (ImageAttachment.jsx:65's `bucket !== '__undefined__'` check) — a `filepath` under this sentinel bucket still routes to the legacy/base64 download branch. */
const UNASSIGNED_BUCKET_SENTINEL = '__undefined__';

/** Not exported beyond this module (knip: no outside import of either branch by name) — each is only ever named as a member of the `AttachmentDownloadPlan` union below. */
interface ArtifactStorageDownload {
  readonly kind: 'artifact-storage';
  readonly filepath: string;
}

interface LegacyBase64Download {
  readonly kind: 'legacy-base64';
}

export type AttachmentDownloadPlan = ArtifactStorageDownload | LegacyBase64Download;

/**
 * ImageAttachment.jsx:63-73 `onClickDown`'s two-branch decision, split out
 * as a pure function: a real, non-sentinel `filepath` routes to artifact
 * storage (`downloadAttachmentFromArtifact`); everything else (no filepath,
 * or the `__undefined__` sentinel bucket) routes to the legacy base64/File
 * branch (`downloadAttachmentImage`).
 */
export function planAttachmentDownload(attachment: Attachment): AttachmentDownloadPlan {
  const details = storedItemDetails(attachment);
  const filepath = nonEmpty(details?.filepath);
  if (filepath !== undefined && details?.bucket !== UNASSIGNED_BUCKET_SENTINEL) {
    return { kind: 'artifact-storage', filepath };
  }
  return { kind: 'legacy-base64' };
}

/** `ImageAttachmentViewerModal`'s `artifactFilepath`/`projectId` props, pre-shaped for conditional spreading under `exactOptionalPropertyTypes`. Split out of `ImageAttachment.tsx` so its own §3.5 cyclomatic-complexity budget isn't spent on this prop-shaping ternary/spread logic — `planAttachmentDownload`'s `'artifact-storage'` branch is what feeds the viewer modal's full-resolution-original fetch (see that file's own doc comment). */
export interface ViewerModalArtifactProps {
  readonly artifactFilepath?: string;
  readonly projectId?: string;
}

export function viewerModalArtifactProps(attachment: Attachment, projectId: string | undefined): ViewerModalArtifactProps {
  const plan = planAttachmentDownload(attachment);
  const artifactFilepath = plan.kind === 'artifact-storage' ? plan.filepath : undefined;
  return {
    ...(artifactFilepath !== undefined ? { artifactFilepath } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
  };
}

/**
 * `/{bucket}/{filename}` -> `{bucket, filename}` — old app: `parseFilepath`,
 * common/utils.jsx:359-370. Mirrors the identically-named private helper in
 * `entities/attachment/lib/download.ts` (not exported from there) and its
 * public duplicate in the sibling `features/chat-messages/ui/attachments/
 * attachmentDownload.helpers.ts` — same no-sideways-features-style boundary
 * reasoning as `planAttachmentDownload` above: this cluster cannot import a
 * private helper from another slice, so it keeps its own copy. Needed by
 * `ImageAttachmentViewerModal.tsx` to split a `planAttachmentDownload`
 * 'artifact-storage' `filepath` into the `bucket`/`filePath` pair
 * `fetchArtifactBlob` takes. Returns `null` on malformed input instead of
 * throwing (§3.6).
 */
export function parseAttachmentFilepath(filepath: string): { readonly bucket: string; readonly filename: string } | null {
  if (!filepath.startsWith('/')) return null;
  const parts = filepath.slice(1).split('/');
  const bucket = parts[0];
  const filename = parts.slice(1).join('/');
  if (bucket === undefined || bucket === '' || filename === '') return null;
  return { bucket, filename };
}
