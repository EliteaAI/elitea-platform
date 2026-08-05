/**
 * Shared param types for this cluster's two attachment-composing hooks
 * (`useChatAttachments.ts` / `useNewConversationAttachments.ts`).
 *
 * These are narrow structural duplicates of entities/attachment's own
 * (unexported) `AttachmentGateParticipant`/`AttachmentGateParticipantDetails`
 * (`src/entities/attachment/model/types.ts`) — NOT an import of them.
 * Two independent reasons, both real:
 *  1. entities/attachment's barrel (`index.ts`) does not re-export either
 *     type (only `Attachment` is spent from its §3.5 budget) — a deep
 *     import (`entities/attachment/model/types`) would violate
 *     dependency-cruiser's `no-deep-slice-import-cross-slice` rule
 *     (`.dependency-cruiser.cjs`: slices are entered through `index.ts`
 *     only).
 *  2. Even if it were exported, `getAttachmentDisabledStatus` (the sole
 *     consumer of these shapes) is typed structurally — any object with the
 *     right fields satisfies it, named-import or not. This is the exact
 *     "each slice re-declares the minimal inline shape it needs" convention
 *     `entities/attachment/model/types.ts`'s own module doc documents for
 *     the identical situation one layer down (it duplicates a field of
 *     `entities/conversation`'s wire participant rather than importing
 *     across the same `no-sideways-entities` fence).
 *
 * Field provenance: `entity_name` — apps/elitea-ui/src/hooks/chat/
 * useAttachments.js:20 (`activeParticipant`, raw chat-domain participant,
 * never the normalised `entities/participant` `Participant`).
 * `version_details.meta.internal_tools` — same file, `activeParticipantDetails`
 * (the fetched agent/pipeline version-details blob).
 */

export interface ChatAttachmentsParticipantGate {
  readonly entity_name?: string;
}

export interface ChatAttachmentsParticipantDetailsGate {
  readonly version_details?: {
    readonly meta?: {
      readonly internal_tools?: readonly string[];
    } | null;
  } | null;
}
