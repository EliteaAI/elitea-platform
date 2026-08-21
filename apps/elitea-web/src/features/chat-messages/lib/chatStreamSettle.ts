/**
 * Ends the in-flight state of a chat message when the transport gives up.
 *
 * Split out of `model/useChatStreamTransport.ts` to keep that file inside the
 * §3.5 file-length budget of 400 lines. The HITL resume path added the
 * `subscribeToRun` and `resume` callbacks, which pushed it to 415.
 */
import type { ChatMessage } from './convertMessagesToChatHistory';

/**
 * Clear the in-flight flags on whatever is still streaming.
 *
 * A transport failure leaves the run's message spinning forever otherwise:
 * the frames that would have ended it are exactly the ones that stopped
 * arriving.
 */
export function settleInFlight(history: readonly ChatMessage[], exception?: unknown): readonly ChatMessage[] {
  let changed = false;
  const next = history.map((message) => {
    if (!message.isStreaming && !message.isLoading) return message;
    changed = true;
    return {
      ...message,
      isStreaming: false,
      isLoading: false,
      isRegenerating: false,
      ...(exception !== undefined ? { exception } : {}),
    };
  });
  return changed ? next : history;
}
