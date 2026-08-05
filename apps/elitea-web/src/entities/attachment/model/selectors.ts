/**
 * Pure attachment selectors, ported from apps/elitea-ui/src/[fsd]/entities/
 * attachment/lib/helpers/attachment.helpers.js. See `./types.ts`'s module
 * doc for the 3-variant `Attachment` union these all operate over.
 */
import { ChatParticipantType } from '@/shared/lib/chat';

import type {
  Attachment,
  AttachmentContentItem,
  AttachmentGateParticipant,
  AttachmentGateParticipantDetails,
  AttachmentItemDetails,
  AttachmentRecord,
} from './types';

/** Narrows the 3-variant `Attachment` union to the "wire record" branch (the only branch with `item_details`/a settable `name`). */
function isAttachmentRecord(attachment: Attachment): attachment is AttachmentRecord {
  return typeof attachment !== 'string' && !(attachment instanceof File);
}

/**
 * `Array.isArray`'s built-in `arg is any[]` predicate does not narrow a
 * `readonly T[] | T` union in the negative (`else`) branch — `readonly T[]`
 * is not a subtype of the mutable `any[]` the predicate asserts, so TS
 * cannot subtract it out (confirmed independently: a 4-line repro with no
 * project config reproduces the same TS2339). An explicit predicate typed
 * exactly against this union's own member fixes it.
 */
function isContentItemArray(
  content: readonly AttachmentContentItem[] | AttachmentContentItem,
): content is readonly AttachmentContentItem[] {
  return Array.isArray(content);
}

/**
 * attachment.helpers.js's local `findContentByType(content, type)`, narrowed
 * to the one `type` (`'image_url'`) this slice's functions ever look for.
 */
function findImageUrlContent(content: AttachmentItemDetails['content']): AttachmentContentItem | undefined {
  if (content === undefined) return undefined;
  if (isContentItemArray(content)) return content.find((item) => item.type === 'image_url');
  return content.type === 'image_url' ? content : undefined;
}

/**
 * attachment.helpers.js:22-35 `getImageSource`, ported verbatim (restructured
 * only to satisfy TS narrowing over the 3-variant `Attachment` union — the
 * behaviour, including the `filepath:` skip, is unchanged: those URLs are
 * internal references the indexer resolves at predict time and replaces
 * with `data:` thumbnail URLs, so surfacing one as an `<img src>` would
 * 404).
 */
export function getImageSource(attachment: Attachment): string | null {
  if (isAttachmentRecord(attachment)) {
    const url = findImageUrlContent(attachment.item_details?.content)?.image_url?.url;
    if (url !== undefined && url !== '' && !url.startsWith('filepath:')) {
      return url;
    }
  }
  if (attachment instanceof File) return URL.createObjectURL(attachment);
  if (typeof attachment === 'string') return attachment;
  return null;
}

/** attachment.helpers.js:38-42 `hasUnresolvedFilepath`, ported verbatim. */
export function hasUnresolvedFilepath(attachment: Attachment): boolean {
  if (!isAttachmentRecord(attachment)) return false;
  const url = findImageUrlContent(attachment.item_details?.content)?.image_url?.url;
  return typeof url === 'string' && url.startsWith('filepath:');
}

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value !== '' ? value : undefined;
}

/** attachment.helpers.js:44-52 `getAttachmentName`'s `item_details`-only fallback chain, split out to keep `getAttachmentName` itself under the §3.5 complexity budget. */
function nameFromRecord(attachment: AttachmentRecord): string | undefined {
  const itemDetails = attachment.item_details;
  return nonEmpty(itemDetails?.name) ?? nonEmpty(attachment.name) ?? nonEmpty(itemDetails?.filepath)?.split('/').pop();
}

/**
 * attachment.helpers.js:44-52 `getAttachmentName`. DEVIATION (disclosed):
 * the baseline's 3rd branch reads `attachment.item_details.filepath`
 * WITHOUT the `?.` its own 1st branch uses on the same `item_details` — an
 * unintentional asymmetry that throws for any attachment with no
 * `item_details` at all AND no top-level `name` (e.g.
 * `getAttachmentName('some-url-string')` on the baseline throws
 * `Cannot read properties of undefined (reading 'filepath')`). Guarded here
 * with `?.` throughout instead of reproducing the crash — not a business-
 * rule change, just closing an evident bug in three near-identical
 * branches.
 */
export function getAttachmentName(attachment: Attachment): string {
  if (isAttachmentRecord(attachment)) return nameFromRecord(attachment) ?? 'attachment';
  if (attachment instanceof File) return nonEmpty(attachment.name) ?? 'attachment';
  return 'attachment';
}

/**
 * attachment.helpers.js's `getAttachmentDisabledStatus`. Logic matches
 * backend `generate_toolkit_payload()` (baseline's own comment, preserved):
 * LLM/dummy participants are always enabled; agent/pipeline participants
 * gate on `'attachments'` membership in
 * `participantDetails.version_details.meta.internal_tools`.
 */
export function getAttachmentDisabledStatus(
  participant: AttachmentGateParticipant | null | undefined,
  participantDetails: AttachmentGateParticipantDetails | null | undefined,
): boolean {
  const isAppOrPipeline =
    participant?.entity_name === ChatParticipantType.Applications ||
    participant?.entity_name === ChatParticipantType.Pipelines;
  if (!isAppOrPipeline) return false;

  const internalTools = participantDetails?.version_details?.meta?.internal_tools ?? [];
  return !internalTools.includes('attachments');
}
