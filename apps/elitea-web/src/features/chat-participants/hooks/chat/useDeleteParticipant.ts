// @ts-nocheck
/**
 * Delete participant hook — ported from `useDeleteParticipant.js`.
 * Delegates to `entities/participant`'s `useDeleteParticipantMutation`.
 */
import { useCallback, useEffect, useRef } from 'react';

import { useDeleteParticipantMutation } from '@/entities/participant';
import { useSelectedProjectId } from '../../api/useSelectedProjectId';
import { useLocalActiveParticipant } from './useLocalActiveParticipant';

function matchesToDelete(participant: Record<string, unknown>, toDelete: Record<string, unknown>): boolean {
  const entityMeta = participant.entity_meta as Record<string, unknown> | undefined;
  const toDeleteMeta = toDelete.entity_meta as Record<string, unknown> | undefined;
  return participant.entity_name === toDelete.entity_name && entityMeta?.id === toDeleteMeta?.id;
}

type SetActiveConversation = (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
type SetConversations = (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void;

/**
 * Temporary (un-persisted) conversation: filter the participant out of
 * local state only, no API call — ported from `useDeleteParticipant.js:25-64`.
 */
function deleteParticipantLocally(
  participantToDelete: Record<string, unknown>,
  activeConversation: Record<string, unknown> | null,
  activeParticipant: Record<string, unknown> | null,
  setActiveConversation: SetActiveConversation,
  setConversations: SetConversations,
  setActiveParticipant: (p: Record<string, unknown> | null) => void,
  clearLocalActiveParticipant: (conversationId: string) => void,
  newConversationViewRef: React.RefObject<Record<string, unknown> | null> | undefined,
): void {
  setActiveConversation((prev: Record<string, unknown>) => ({
    ...prev,
    participants: (prev.participants as Record<string, unknown>[] | undefined)?.filter((p) => !matchesToDelete(p, participantToDelete)),
  }));
  setConversations((prev: Record<string, unknown>[]) =>
    prev.map((conv) =>
      conv.id === activeConversation?.id
        ? { ...conv, participants: (conv.participants as Record<string, unknown>[] | undefined)?.filter((p) => !matchesToDelete(p, participantToDelete)) }
        : conv,
    ),
  );
  if (activeParticipant?.id === participantToDelete.id) {
    setActiveParticipant(null);
    clearLocalActiveParticipant(String((activeConversation?.id as string) ?? ''));
  }
  // @ts-expect-error — current is Record<string, unknown>, not a ref object
  newConversationViewRef?.current?.onDeleteParticipant?.(participantToDelete);
}

/** Persisted conversation: delete via the API, mirroring only on success. */
function deleteParticipantViaApi(
  participantToDelete: Record<string, unknown>,
  activeConversation: Record<string, unknown> | null,
  activeParticipant: Record<string, unknown> | null,
  deleteParticipant: (args: unknown) => void,
  projectId: string | undefined,
  setActiveConversation: SetActiveConversation,
  setConversations: SetConversations,
  setActiveParticipant: (p: Record<string, unknown> | null) => void,
  clearLocalActiveParticipant: (conversationId: string) => void,
  toastError: (msg: string) => void,
): void {
  const id = String(participantToDelete.id);

  try {
    deleteParticipant({ projectId, conversationId: String((activeConversation?.id as string) ?? ''), id });

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
      clearLocalActiveParticipant(String((activeConversation?.id as string) ?? ''));
    }
  } catch (err) {
    toastError(err instanceof Error ? err.message : 'Failed to delete participant');
  }
}

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
  newConversationViewRef,
}: {
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void;
  activeConversation: Record<string, unknown> | null;
  activeParticipant: Record<string, unknown> | null;
  setActiveParticipant: (p: Record<string, unknown> | null) => void;
  toastError: (msg: string) => void;
  newConversationViewRef?: React.RefObject<Record<string, unknown> | null>;
}) {
  const projectId = useSelectedProjectId();
  const { mutate: deleteParticipant, isError, error } = useDeleteParticipantMutation();
  const { clearLocalActiveParticipant } = useLocalActiveParticipant();

  // Bundled into one ref (not a §3.5-budgeted 10-entry dep array) so
  // `onDeleteParticipant`'s identity stays stable while always reading the
  // latest values — same pattern this codebase already uses for callbacks
  // with many reactive inputs (e.g. widgets/chat-box/ui/ChatBox.tsx's
  // `useStableRef`-wrapped handlers).
  const latestRef = useRef({
    activeConversation, activeParticipant, clearLocalActiveParticipant, deleteParticipant,
    newConversationViewRef, projectId, setActiveConversation, setConversations, setActiveParticipant, toastError,
  });
  latestRef.current = {
    activeConversation, activeParticipant, clearLocalActiveParticipant, deleteParticipant,
    newConversationViewRef, projectId, setActiveConversation, setConversations, setActiveParticipant, toastError,
  };

  const onDeleteParticipant = useCallback((participantToDelete: Record<string, unknown>) => {
    const {
      activeConversation, activeParticipant, clearLocalActiveParticipant, deleteParticipant,
      newConversationViewRef, projectId, setActiveConversation, setConversations, setActiveParticipant, toastError,
    } = latestRef.current;

    if (activeConversation?.isNew || !activeConversation?.id) {
      deleteParticipantLocally(
        participantToDelete,
        activeConversation,
        activeParticipant,
        setActiveConversation,
        setConversations,
        setActiveParticipant,
        clearLocalActiveParticipant,
        newConversationViewRef,
      );
      return;
    }

    deleteParticipantViaApi(
      participantToDelete,
      activeConversation,
      activeParticipant,
      deleteParticipant,
      projectId,
      setActiveConversation,
      setConversations,
      setActiveParticipant,
      clearLocalActiveParticipant,
      toastError,
    );
  }, []);

  const onRemoteDeleteParticipant = useCallback(
    (conversationId: string, participantId: string) => {
      if (conversationId === activeConversation?.id) {
        setActiveConversation((prev: Record<string, unknown>) => ({
          ...prev,
          participants: prev.participants?.filter((p: Record<string, unknown>) => p.id !== participantId),
        }));
        if (activeParticipant?.id === participantId) {
          setActiveParticipant(null);
          clearLocalActiveParticipant(conversationId);
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
    [activeConversation, activeParticipant, clearLocalActiveParticipant, setActiveConversation, setActiveParticipant, setConversations],
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
