import { create, type StoreApi, type UseBoundStore } from 'zustand';

/**
 * Zustand port of `apps/elitea-ui/src/slices/chat.js` (unit C1) — the
 * baseline's Redux `chat` slice. This app has no Redux; `zustand` is the
 * established substitute (`widgets/app-shell/model/navBlocker.store.ts`,
 * `features/toolkits/indexes/model/indexesStore.ts`).
 *
 * **What ported, and what did not (3 of the baseline's 7 state slots):**
 *
 * - `messageIdToView`, `currentStreamingInfo`, `isCreatingNewConversation` —
 *   genuine cross-component client state with real consumers in this
 *   unit's owned files: `messageIdToView` by `useHighlightUserMessage.js`,
 *   `currentStreamingInfo` by `useChatStreaming.js`, and
 *   `isCreatingNewConversation` set (`false`) by `useSelectConversation.js`
 *   on every successful selection.
 *
 * - `toolkitValidationInfo`, `selectedAgent`, `selectedAgentStarter`,
 *   `currentChatModel` — NOT ported. Grepped every file this unit's brief
 *   names (`chat.api.js`, the 4 `useCreateConversation`/`useSelectConversation`/
 *   `useDeleteConversation`/`useEditConversation` lifecycle hooks,
 *   `useConversationNavigation.hooks.js`, `useResetCreateFlag.js`,
 *   `useUpdateConversationTimestamp.js`, `useHighlightUserMessage.js`,
 *   `useChatStreaming.js`, `useAttachmentState.js`/`useUploadAttachments.js`,
 *   `chat.helpers.js`, `newConversation.helpers.js`) — zero read or write of
 *   any of these four anywhere in that set (the baseline's own
 *   `setToolkitValidationInfo`/`setSelectedAgentInfo`/`setCurrentChatModel`
 *   action creators and the `validateToolkit.matchFulfilled` extraReducer
 *   live entirely outside this unit's files, in the chat COMPONENT tree a
 *   future C2-C6 unit owns). Declining an unused Redux slot has a direct
 *   precedent in this codebase: `features/agents/model/applicationsStore.ts`'s
 *   own doc comment makes the identical "3 of the baseline's 6 state slots"
 *   call for the same reason. If a future unit finds a real consumer of one
 *   of these four, it should extend this store then — not invent a second,
 *   parallel one.
 *
 * Lazy-singleton factory pattern (R-S2: "No store may be created at module
 * scope in a file that is also imported by `app/`") — mirrors
 * `applicationsStore.ts`'s own documented convention.
 */

/** `state.chat.currentStreamingInfo` — `projectId -> conversationId -> questionId` (`slices/chat.js:20-29`). */
export type StreamingInfoByProject = Readonly<Record<string, Readonly<Record<string, string>>>>;

interface ChatSessionState {
  readonly messageIdToView: string;
  readonly currentStreamingInfo: StreamingInfoByProject;
  readonly isCreatingNewConversation: boolean;
  readonly setMessageIdToView: (messageIdToView: string) => void;
  readonly setStreamingInfo: (projectId: string, conversationId: string, questionId: string) => void;
  readonly clearConversationStreamingInfo: (projectId: string, conversationId: string) => void;
  readonly resetStreamingInfo: () => void;
  readonly setIsCreatingNewConversation: (isCreatingNewConversation: boolean) => void;
}

type ChatSessionStore = UseBoundStore<StoreApi<ChatSessionState>>;

function createChatSessionStore(): ChatSessionStore {
  return create<ChatSessionState>((set) => ({
    messageIdToView: '',
    currentStreamingInfo: {},
    isCreatingNewConversation: false,
    setMessageIdToView: (messageIdToView) => set({ messageIdToView }),
    setStreamingInfo: (projectId, conversationId, questionId) =>
      set((state) => ({
        currentStreamingInfo: {
          ...state.currentStreamingInfo,
          [projectId]: { ...state.currentStreamingInfo[projectId], [conversationId]: questionId },
        },
      })),
    clearConversationStreamingInfo: (projectId, conversationId) =>
      set((state) => {
        const forProject = state.currentStreamingInfo[projectId];
        if (!forProject || !(conversationId in forProject)) return state;
        const nextForProject = { ...forProject };
        delete nextForProject[conversationId];
        return { currentStreamingInfo: { ...state.currentStreamingInfo, [projectId]: nextForProject } };
      }),
    resetStreamingInfo: () => set({ currentStreamingInfo: {} }),
    setIsCreatingNewConversation: (isCreatingNewConversation) => set({ isCreatingNewConversation }),
  }));
}

let instance: ChatSessionStore | undefined;

function resolveStore(): ChatSessionStore {
  instance ??= createChatSessionStore();
  return instance;
}

function useChatSessionStoreHook<T>(selector: (state: ChatSessionState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the same hook + getState/setState surface this codebase's other stores use. */
export const useChatSessionStore = Object.assign(useChatSessionStoreHook, {
  getState: (): ChatSessionState => resolveStore().getState(),
  setState: (partial: Partial<ChatSessionState>): void => resolveStore().setState(partial),
});
