import { useAttachmentToolChange } from './useAttachmentToolChange.hooks';
import { useNewInputKeyDownHandler, useNewStartConversationInputKeyDownHandler } from './useInputKeyDownHandler.hooks';

/**
 * Barrel-budget bundle for this slice's public `index.ts` (§3.5: ≤20 named
 * exports per slice, shared across every C3 sub-cluster landing in this
 * worktree — see `index.ts`'s own doc comment for the full accounting).
 * Groups three otherwise-unrelated hooks — `useNewInputKeyDownHandler`/
 * `useNewStartConversationInputKeyDownHandler` (`useInputKeyDownHandler
 * .hooks.ts`) and `useAttachmentToolChange` (`useAttachmentToolChange
 * .hooks.ts`) — purely to spend 1 export slot instead of 3, matching this
 * app's established "bundle related functions into one object literal"
 * convention (`entities/conversation`'s `conversationApi`, `entities/
 * folder`'s `folderApi`). None of the three are consumed anywhere inside
 * this cluster itself — see each hook's own file for the "consumed by a
 * future composition-root unit" disclosure.
 */
export const chatInputCompositionHooks = {
  useAttachmentToolChange,
  useNewInputKeyDownHandler,
  useNewStartConversationInputKeyDownHandler,
};
