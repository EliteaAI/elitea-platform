/**
 * Public API — spec §3.3: named exports only, CURATED.
 *
 * Ten symbols, and every one of them has a consumer at `widgets/deepwiki`. The
 * first version of this file exported twenty-three — everything the slice
 * declares — and that is a barrel rather than an API: it publishes the reducer,
 * the poll adapter and the whole frame vocabulary, none of which anything
 * outside this slice calls. The §3.5 budget caught it.
 *
 * What is DELIBERATELY not here, and how to reach it if that changes:
 *
 *   - `reduceChatFrame` / `reduceChatFrames` — the reducer is driven by
 *     `useWikiChat` and by nothing else. A second driver is a reason to export
 *     it; wanting to test it is not, because its tests live in the slice.
 *   - `framesFromChatPoll` / `isTerminalChatPoll` / `ChatFrame` /
 *     `ChatFrameType` — the transport vocabulary. It becomes public when a
 *     second transport feeds this reducer (issue #701 would be that change).
 *   - `initialChatState` / `ChatState` / `ChatResult` / `ChatTurn` — the state
 *     shape. Exporting it invites a widget to reconstruct state instead of
 *     reading the controller, which is how a drawer and a stream come to
 *     disagree about whether a turn is running.
 *   - `CHAT_POLL_INTERVAL_MS` / `WikiChatOptions` — reachable through
 *     `WikiChatController` and the options object; neither is named by a caller.
 */
export { useWikiChat } from './model/useWikiChat';
export type {
  ChatInvokeInput,
  ChatStorage,
  WikiChatController,
} from './model/useWikiChat';
export type { ChatInvocationPoll } from './lib/framesFromChatPoll';
export { isThinkingBlock } from './model/types';
export type {
  ChatCapability,
  ChatMessage,
  ChatThinkingBlock,
  ChatThinkingStep,
  ChatTodo,
} from './model/types';
