import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';

import type { Conversation } from '@/entities/conversation';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/conversation-list/ui/
 * conversations/PinnedConversations.jsx` (unit C2).
 *
 * Generic over `TConversation` (bounded by `entities/conversation`'s
 * `Conversation`) rather than hard-coded to it: `ConversationItem.tsx`'s own
 * `conversation` prop is typed `ConversationWithOwnerMeta` (a local
 * superset — see that file's doc comment for why `Conversation` alone is
 * missing `authorId`/`usersCount`), and `Conversations.tsx`'s
 * `renderConversationItem` render-prop is built against that wider type.
 * TypeScript's contravariant parameter checking means a `(c: Conversation)
 * => ReactNode` prop type could NOT accept a narrower
 * `(c: ConversationWithOwnerMeta) => ReactNode` callback — making this
 * component generic (matching `lib/helpers/conversationList.helpers.ts`'s
 * own `ConversationGroup<TConversation>` precedent) lets it stay ignorant of
 * which concrete conversation shape a caller uses, exactly as the brief's
 * "never imports ConversationItem directly" instruction intends: the
 * render-prop is the only seam.
 */
export interface PinnedConversationsProps<TConversation extends Conversation> {
  readonly pinnedConversations: readonly TConversation[];
  readonly renderConversationItem: (conversation: TConversation, onItemHover: (itemId: string, isHovered: boolean) => void, isNextItemHovered: boolean) => ReactNode;
}

export function PinnedConversations<TConversation extends Conversation>({ pinnedConversations, renderConversationItem }: PinnedConversationsProps<TConversation>): ReactNode {
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  const handleItemHover = useCallback((itemId: string, isHovered: boolean) => {
    setHoveredItemId(isHovered ? itemId : null);
  }, []);

  return (
    <>
      {pinnedConversations.map((conversation, index) => {
        const nextConversation = pinnedConversations[index + 1];
        const isNextItemHovered = nextConversation?.id === hoveredItemId;
        return renderConversationItem(conversation, handleItemHover, isNextItemHovered);
      })}
    </>
  );
}
