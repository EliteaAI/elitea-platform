/**
 * `ChatBoxProps`'s bundle unwrapping.
 *
 * Its own file for the same reason `ChatBox.types.ts` and `ChatBox.layout.ts`
 * are: `ChatBox.helpers.ts` sits at the §3.5 400-line file budget with no
 * headroom, and `ChatBox.tsx` is at its complexity budget — an inline
 * `conversation ?? {}` in the component costs it one branch too many.
 */
import type { ChatBoxActiveConversation } from './ChatBox.helpers';

/** `ChatBoxProps.conversation` — the conversation on screen, and whether it is still arriving. */
export interface ChatBoxConversationProp {
  readonly active?: ChatBoxActiveConversation;
  readonly isLoading?: boolean;
}

/** Flattens the `conversation` bundle back into the two values `ChatBox` reads (baseline: the separate `activeConversation`/`isLoadingConversation` props, bundled to stay under the §3.5 component-props budget once `ref` became a prop). */
export function unwrapChatBoxConversation(conversation: ChatBoxConversationProp | undefined): {
  readonly activeConversation: ChatBoxActiveConversation | undefined;
  readonly isLoadingConversation: boolean | undefined;
} {
  return { activeConversation: conversation?.active, isLoadingConversation: conversation?.isLoading };
}
