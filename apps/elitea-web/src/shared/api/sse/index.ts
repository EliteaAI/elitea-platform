/**
 * Public surface of the SSE transport module (issue #92). Named exports
 * only (`elitea/no-export-all`), curated the same way `shared/config`'s
 * barrel is.
 *
 * `./testing.ts` is deliberately NOT re-exported: it is test-only
 * machinery, imported deeply by the tests that need it — the same split
 * `shared/api/socket/testing.ts` already uses.
 */
export { useEventSource } from './useEventSource';
export type { ExecutionEventData } from './executionEvents';
/**
 * `useExecutionEventStream` (subscribe by a server-supplied `events_url`)
 * is deliberately NOT re-exported: its only caller today is
 * `useExecutionEvents` inside the same module. The chat surface that needed
 * the by-url form does not subscribe yet — see `widgets/chat-box/ui/hooks/
 * useChatBoxHandlers.ts` — so exporting it here would be a dead barrel
 * symbol (knip's gate agrees).
 */
export { useExecutionEvents } from './executionEvents';
