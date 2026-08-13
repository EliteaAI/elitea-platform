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
 * `useExecutionEventStream` subscribes by the `events_url` the START
 * endpoint returned, rather than re-deriving the path — the server owns that
 * shape. It was withheld from this barrel while the chat surface had no
 * consumer for the streamed envelope; `features/chat-messages`'s
 * `useChatStreamTransport` is that consumer, so the condition no longer
 * holds.
 */
export { useExecutionEventStream, useExecutionEvents } from './executionEvents';
