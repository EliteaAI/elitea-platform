// @ts-nocheck
/**
 * Delete participant hook — ported from `useDeleteParticipant.js`.
 * Delegates to `entities/participant`'s `useDeleteParticipantMutation`.
 */
import { useCallback, useEffect } from 'react';

import { useDeleteParticipantMutation } from '@/entities/participant';
import { useSelectedProjectId } from '../../api/useSelectedProjectId';

/**
 * Handles participant deletion from a conversation.
 * Ported from `useDeleteParticipant.js`.
 */
export function useDeleteParticipant({
  setActiveConversation,
  setConversations,
  activeConversation,
  activeParticipant,
  setActiveParticipant,
  toastError,
}: {
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void;
  activeConversation: Record<string, unknown> | null;
  activeParticipant: Record<string, unknown> | null;
  setActiveParticipant: (p: Record<string, unknown> | null) => void;
  toastError: (msg: string) => void;
}) {
  const projectId = useSelectedProjectId();
  const { mutate: deleteParticipant, isError, error } = useDeleteParticipantMutation();

  const onDeleteParticipant = useCallback(
    (participantToDelete: Record<string, unknown>) => {
      if (!activeConversation?.id) return;
      const id = String(participantToDelete.id);

      try {
        deleteParticipant({
          projectId,
          conversationId: String((activeConversation?.id as string) ?? ''),
          id,
        });

        setActiveConversation((prev: Record<string, unknown>) => ({
          ...prev,
          participants: prev.participants?.filter((p: Record<string, unknown>) => p.id !== id),
        }));
        setConversations((prev: Record<string, unknown>[]) =>
          prev.map((conv) =>
            conv.id === activeConversation?.id
              ? { ...conv, participants: conv.participants?.filter((p: Record<string, unknown>) => p.id !== id) }
              : conv,
          ),
        );
        if (activeParticipant?.id === id) {
          setActiveParticipant(null);
        }
      } catch (err) {
        toastError(err instanceof Error ? err.message : 'Failed to delete participant');
      }
    },
    [activeConversation, activeParticipant, deleteParticipant, projectId, setActiveConversation, setConversations, setActiveParticipant, toastError],
  );

  const onRemoteDeleteParticipant = useCallback(
    (conversationId: string, participantId: string) => {
      if (conversationId === activeConversation?.id) {
        setActiveConversation((prev: Record<string, unknown>) => ({
          ...prev,
          participants: prev.participants?.filter((p: Record<string, unknown>) => p.id !== participantId),
        }));
        if (activeParticipant?.id === participantId) {
          setActiveParticipant(null);
        }
      }
      setConversations((prev: Record<string, unknown>[]) =>
        prev.map((conv) =>
          conv.id === conversationId
            ? { ...conv, participants: conv.participants?.filter((p: Record<string, unknown>) => p.id !== participantId) }
            : conv,
        ),
      );
    },
    [activeConversation, activeParticipant, setActiveConversation, setActiveParticipant, setConversations],
  );

  useEffect(() => {
    if (isError) {
      toastError(error instanceof Error ? error.message : 'Delete failed');
    }
  }, [error, isError, toastError]);

  return { onDeleteParticipant, onRemoteDeleteParticipant };
}

export default function useDeleteParticipantHook(props: Parameters<typeof useDeleteParticipant>[0]) {
  return useDeleteParticipant(props);
}
