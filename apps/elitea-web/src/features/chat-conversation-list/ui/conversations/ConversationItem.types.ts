import type { Conversation } from '@/entities/conversation';

/**
 * Shared leaf type for the `ConversationItem.*` file cluster
 * (`ConversationItem.tsx`/`.menu.tsx`/`.row.tsx`) — split out to its own
 * file so `.menu.tsx`/`.row.tsx` can depend on it without a circular import
 * back to `ConversationItem.tsx` (which itself imports FROM `.menu.tsx`/
 * `.row.tsx`).
 *
 * `entities/conversation`'s `Conversation` doesn't model `author_id`/
 * `users_count`/`isNew` — a disclosed gap already flagged by this same
 * feature's own `lib/hooks/useQueryFoldersList.hooks.ts` module doc
 * (`toConversation`'s doc comment, citing `ConversationItem.jsx:57-66`:
 * "destructures `name`/`is_private`/`users_count`/`author_id`/… directly
 * off exactly this list-row shape... a future phase should either widen
 * `FolderConversationRef` to the real wire shape or give this list-row
 * concept its own narrower type"). This IS that future phase. Widened here
 * via intersection rather than editing `entities/conversation/model/
 * types.ts` (out of this unit's scope, and one leaf feature widening a
 * shared entity type on its own say-so would just relocate the same
 * disclosed-gap problem) — baseline: `ConversationItem.jsx:56-66`.
 * `isNew` is `DraftConversation`'s own field (a narrower, differently-shaped
 * sibling of `Conversation`); folded in here as optional so one prop type
 * covers both the ordinary and not-yet-persisted-draft rows this component
 * actually receives (baseline reads `isNew` off whichever it's given,
 * `ConversationItem.jsx:63,78,323-351,469-503`).
 */
export interface ConversationWithOwnerMeta extends Conversation {
  readonly authorId?: string | undefined;
  readonly usersCount?: number | undefined;
  readonly isNew?: boolean | undefined;
}
