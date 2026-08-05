/**
 * Attachment domain type — an image/file attached to a chat message
 * (agent/pipeline chat input). This is a NEW slice: no counterpart exists
 * anywhere in apps/elitea-web yet. Ported from apps/elitea-ui/src/[fsd]/
 * entities/attachment/lib/helpers/attachment.helpers.js — the old app's own
 * only source for this domain.
 *
 * The wire shape has three real variants, all handled by the old app's
 * helpers and preserved here (evidenced at the two usage sites this port is
 * based on: [fsd]/features/chat/ui/chat-attachment/ImageAttachment.jsx and
 * hooks/chat/useAttachments.js):
 *  1. `AttachmentRecord` — the "new" wire shape, `item_details.content`
 *     carrying an `image_url` content item (list format, possibly mixed
 *     with other content kinds; or the legacy un-wrapped dict format), OR
 *     the "old custom bucket" shape, `item_details.filepath` +
 *     `item_details.name`.
 *  2. A raw `File` — a just-picked, not-yet-uploaded local file.
 *  3. A raw `string` — a direct URL (old code's defensive fallback for
 *     already-resolved values passed straight through).
 *
 * Only the fields this slice's ported functions actually read are modeled.
 * `item_details.bucket` (read by ImageAttachment.jsx to decide WHICH
 * download path to use) is deliberately NOT modeled here — it belongs to
 * that sibling cluster's own prop/param, not to any function this slice
 * exports; adding it would invent a field no function here reads.
 */

/**
 * A single `item_details.content` entry — old app's local
 * `findContentByType` (attachment.helpers.js), matched by `.type`. Only the
 * `image_url` shape is modeled; other content kinds (e.g. `text`,
 * `file_data`) exist on the real wire but are never read by any function
 * this slice exports.
 */
export interface AttachmentContentItem {
  readonly type?: string;
  readonly image_url?: {
    readonly url?: string;
  };
}

/**
 * `item_details.content` is either the "new" list format (multiple content
 * items) or the "legacy" dict format (a single content item, un-wrapped) —
 * both real and both still produced by conversations created before the
 * list-format migration (attachment.helpers.js's own `findContentByType`
 * comment: "Handle dict format (legacy)").
 */
export interface AttachmentItemDetails {
  readonly name?: string;
  /** Old custom-bucket attachments: `/{bucket}/{filename}` — read by `getAttachmentName`'s fallback. */
  readonly filepath?: string;
  readonly content?: readonly AttachmentContentItem[] | AttachmentContentItem;
}

/** The "new" wire shape (also covers old custom-bucket attachments via `item_details.filepath`). */
export interface AttachmentRecord {
  readonly item_details?: AttachmentItemDetails;
  /** Set on a locally-picked file-like object before `item_details` exists (`getAttachmentName`'s 2nd fallback, attachment.helpers.js:63). */
  readonly name?: string;
}

/** A chat attachment as read by this slice's selectors — see the module doc for the three real variants. */
export type Attachment = AttachmentRecord | File | string;

/**
 * Minimal RAW-wire participant shape `getAttachmentDisabledStatus` reads
 * (`entity_name`). `entities/attachment` cannot import
 * `entities/conversation`'s `ChatParticipantWire` (no-sideways-entities), so
 * this is a narrow structural duplicate of just the one field this gate
 * needs — the same disclosed-duplication convention
 * `entities/application/model/types.ts`'s module doc documents ("each slice
 * re-declares the minimal inline shape it needs rather than importing this
 * file"). Precedent for the RAW (not normalised-camelCase) convention
 * specifically: `entities/conversation/lib/chat.helpers.ts:232` gates the
 * identical field the identical way, on the identical raw wire shape,
 * because both are ports of pure old-app helpers that never see a
 * normalised `Participant` — only whatever raw participant object the old
 * app's Redux state happened to hold.
 */
export interface AttachmentGateParticipant {
  readonly entity_name?: string;
}

/**
 * Minimal shape of the fetched agent/pipeline "version details" blob
 * `getAttachmentDisabledStatus` reads (old app: `activeParticipantDetails`,
 * hooks/chat/useAttachments.js:20) — specifically
 * `version_details.meta.internal_tools`. Kept snake_case to match the wire,
 * consistent with how this exact field is already typed elsewhere in the
 * chat domain (e.g. `features/agents/lib/hooks/applicationChat.types.ts`'s
 * `ChatApplicationVersionDetails.meta.internal_tools`) — `entities/
 * attachment` cannot import that type either (it lives in a feature slice
 * this unit doesn't own), so it is duplicated narrowly here too.
 */
export interface AttachmentGateParticipantDetails {
  readonly version_details?: {
    readonly meta?: {
      readonly internal_tools?: readonly string[];
    } | null;
  } | null;
}
