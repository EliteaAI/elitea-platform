/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 * R-L3 mandates every `processes/` slice have one even though this unit's
 * literal `ownedPaths` names only `model/` — `processes/` sits ABOVE every
 * other layer in the import chain (only `app/` may import it), so this
 * barrel's only real consumer is a not-yet-built `app/`-level composition
 * root that wires an actual chat page: every editor's open/close handlers,
 * every socket, every generated form/list widget. Curated for THAT shape —
 * one entry point per cross-feature orchestration concern this unit landed,
 * plus the payload/result types an `app/`-level composer needs to type its
 * own wiring code (constructing callback objects, passing typed props down
 * to widgets) without a deep import into `model/*.ts` (R-L3 forbids that
 * from a different slice/layer just as much as it forbids skipping this
 * barrel entirely).
 *
 * Lands exactly at the 20-export cap — same precedent as `entities/
 * conversation/index.ts`'s own landing (see that file's header). Every
 * hook's remaining PARAMS type and internal result/helper types (e.g.
 * `UseEditorMutexParams`, `UseCloseEditorAlertResult`,
 * `UseChatEntityBrowserParams`) are deliberately left off this list: a
 * caller passes a plain object literal into each hook and TypeScript checks
 * it structurally against the hook's own parameter type without needing
 * that type imported by name. Promote any of them here the moment a real
 * `app/` consumer needs to declare an intermediate typed variable against
 * one and finds this budget's ceiling in the way — the same escape hatch
 * `entities/canvas/index.ts`'s own header documents for its own dropped
 * param-type exports.
 */

// ── Editor mutex + dirty-editor confirm (`useMutuallyExclusiveEditors.js`/`useCloseEditorAlert.js`) ──
export { useEditorMutex } from './model/useEditorMutex';
export type { EditorOpenInfo, CanvasEditPayload, UseEditorMutexResult } from './model/useEditorMutex';
export { useCloseEditorAlert } from './model/useCloseEditorAlert';
export type { CloseEditorType } from './model/useCloseEditorAlert';

// ── Streaming nav-blocker (`useStreamingNavBlocker.js`) ──
export { useStreamingNavBlocker } from './model/useStreamingNavBlocker';

// ── Copy-to-clipboard + interaction-id hooks (`useChatCopyToClipboard.js`/`useCopyEventHandlers.js`/`useChatInteractionUUID.js`) ──
export { useChatCopyToClipboard } from './model/useChatCopyToClipboard';
export type { CopyableChatMessage } from './model/useChatCopyToClipboard';
export { useInteractionUUID, useCopyDownloadHandlers } from './model/useCopyEventHandlers';
export { useChatInteractionUUID } from './model/useChatInteractionUUID';

// ── Message pagination (`useLoadMoreMessages.js`) ──
export { useLoadMoreMessages } from './model/useLoadMoreMessages';
export type { LoadMoreMessagesConversation } from './model/useLoadMoreMessages';

// ── Internal-tools config toggle (`useInternalToolsConfig.hooks.js`) ──
export { useInternalToolsConfig } from './model/useInternalToolsConfig';
export type { InternalToolsConversation } from './model/useInternalToolsConfig';

// ── Refetch-on-close (`useRefetchAgentVersionDetailsOnClose.js`) ──
export { useRefetchAgentVersionDetailsOnClose } from './model/useRefetchAgentVersionDetailsOnClose';

// ── Chat-input "+" submenu data layer (`useDropdownData.jsx`) ──
export { useChatEntityBrowser } from './model/useChatEntityBrowser';
export type { ChatEntityBucket } from './model/useChatEntityBrowser';

// ── Agent<->participant variable sync (`utils/variableSync.js`) ──
export { syncVariableKeys } from './model/variableSync';
