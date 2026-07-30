/**
 * Ported from `apps/elitea-ui/src/hooks/chat/useSyncChatMessage.js` —
 * handles syncing of chat messages across tabs/windows using BroadcastChannel.
 *
 * Port of `apps/elitea-ui/src/hooks/chat/useSyncChatMessage.js`.
 */
import { useEffect, useRef } from 'react';

/** @public Params for `useSyncChatMessage`. */
export interface UseSyncChatMessageParams {
  /** The active conversation ID to sync messages for. */
  readonly conversationId?: string;
  /** Called when a sync message is received from another tab. */
  readonly onSyncMessage?: (message: { type: string; data?: unknown }) => void;
}

/**
 * `useSyncChatMessage` — sets up a BroadcastChannel for cross-tab chat
 * message sync. Messages are broadcast when the local chat history changes
 * and received from other tabs to keep everything in sync.
 */
export function useSyncChatMessage({ conversationId, onSyncMessage }: UseSyncChatMessageParams): void {
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!conversationId) return;

    const channel = new BroadcastChannel(`chat_sync_${conversationId}`);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      onSyncMessage?.(event.data as { type: string; data?: unknown });
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [conversationId, onSyncMessage]);
}

/**
 * Broadcast a chat sync message to other tabs.
 */
export function broadcastChatSyncMessage(conversationId: string, message: { type: string; data?: unknown }): void {
  const channel = new BroadcastChannel(`chat_sync_${conversationId}`);
  channel.postMessage(message);
  channel.close();
}
