// @ts-nocheck
/**
 * Remote participant update hook — ported from `useRemoteParticipantUpdate.js`.
 * Zero external imports beyond `react` — pure state-merge logic.
 */
import { useCallback } from 'react';

/**
 * Handles remote participant updates (from WebSocket events).
 * Ported from `useRemoteParticipantUpdate.js`.
 */
export function useRemoteParticipantUpdate({
  setActiveConversation,
  setConversations,
  activeConversation,
  activeParticipant,
  setActiveParticipant,
}: {
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void;
  activeConversation: Record<string, unknown> | null;
  activeParticipant: Record<string, unknown> | null;
  setActiveParticipant: (p: Record<string, unknown> | null) => void;
}) {
  const onRemoteUpdateParticipant = useCallback(
    (participant: Record<string, unknown>) => {
      setActiveConversation((prev: Record<string, unknown>) => {
        const found = prev.participants?.find((item: Record<string, unknown>) => item.id === participant.id);
        return {
          ...prev,
          participants: found
            ? prev.participants.map((item: Record<string, unknown>) => (item.id === participant.id ? participant : item))
            : [...(prev.participants || []), participant],
        };
      });

      if (activeParticipant?.id === participant.id) {
        setActiveParticipant(participant);
      }

      setConversations((prev: Record<string, unknown>[]) =>
        prev.map((conversation) => {
          if (conversation.id === activeConversation?.id) {
            const found = conversation.participants?.find((item: Record<string, unknown>) => item.id === participant.id);
            return {
              ...conversation,
              participants: found
                ? conversation.participants.map((item: Record<string, unknown>) => (item.id === participant.id ? participant : item))
                : [...(conversation.participants || []), participant],
            };
          }
          return conversation;
        }),
      );
    },
    [activeConversation, activeParticipant, setActiveConversation, setActiveParticipant, setConversations],
  );

  return { onRemoteUpdateParticipant };
}

export default function useRemoteParticipantUpdateHook(props: Parameters<typeof useRemoteParticipantUpdate>[0]) {
  return useRemoteParticipantUpdate(props);
}
