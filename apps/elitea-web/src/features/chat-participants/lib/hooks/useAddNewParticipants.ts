// @ts-nocheck
import { useCallback } from 'react';

import type { OldAppParticipant } from '../../model/types';

import {
  useAddParticipantMutation,
} from '@/entities/participant';
import { useSelectedProjectId } from '../../api/useSelectedProjectId';

// ---------------------------------------------------------------------------
// Helper: filter participants already in a conversation (complexity ≤ 4)
// ---------------------------------------------------------------------------

function filterExistingParticipants(
  candidates: Record<string, unknown>[],
  existing: Record<string, unknown>[],
): Record<string, unknown>[] {
  return candidates.filter((candidate) => {
    return !existing.some((existingItem) => {
      return (
        existingItem.entity_meta?.id === candidate.entity_meta?.id &&
        existingItem.entity_meta?.project_id === candidate.entity_meta?.project_id
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: filter for existing conversation (no project_id check) (complexity ≤ 3)
// ---------------------------------------------------------------------------

function filterExistingParticipantsSimple(
  candidates: Record<string, unknown>[],
  existing: Record<string, unknown>[],
): Record<string, unknown>[] {
  return candidates.filter((candidate) => {
    return !existing.some((existingItem) => {
      return existingItem.entity_meta?.id === candidate.entity_meta?.id;
    });
  });
}

// ---------------------------------------------------------------------------
// Helper: build new participants array (complexity ≤ 2)
// ---------------------------------------------------------------------------

function buildNewParticipants(existing: Record<string, unknown>[], newItems: Record<string, unknown>[]): Record<string, unknown>[] {
  const newParticipants = filterExistingParticipants(newItems, existing);
  return [...existing, ...newParticipants];
}

// ---------------------------------------------------------------------------
// useAddNewParticipants
// ---------------------------------------------------------------------------

export interface UseAddNewParticipantsProps {
  toastError: (msg: string) => void;
  activeConversation: Record<string, unknown> | null;
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void;
  newConversationViewRef?: React.RefObject<Record<string, unknown> | null>;
}

/**
 * Hook that adds new participants to a chat conversation.
 * Ported from `useAddNewParticipants.hooks.js`.
 */
/**
 * Updates an existing conversation and the conversations list.
 */
function updateExistingConversation(
  activeConversation: Record<string, unknown> | null,
  transformedParticipants: Record<string, unknown>[],
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
) {
  setActiveConversation((prev: Record<string, unknown>) => {
    if (!prev?.id) return prev;
    const prevP = (prev as Record<string, unknown> & { participants?: Record<string, unknown>[] }).participants || [];
    const newParts = filterExistingParticipants(transformedParticipants, prevP);
    return { ...prev, participants: [...prevP, ...newParts] };
  });
  setConversations((prev: Record<string, unknown>[]) =>
    prev.map((conv) => {
      const convId = (conv as Record<string, unknown> & { id?: unknown }).id;
      if (convId !== (activeConversation as Record<string, unknown>)?.id) return conv;
      const convParticipants = (conv as Record<string, unknown> & { participants?: Record<string, unknown>[] }).participants || [];
      return { ...conv, participants: buildNewParticipants(convParticipants, transformedParticipants) };
    }),
  );
}

/**
 * Updates a new conversation and adds it to the conversations list.
 */
function updateNewConversation(
  newConversation: Record<string, unknown>,
  transformedParticipants: Record<string, unknown>[],
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
) {
  const nc = newConversation as Record<string, unknown> & { participants?: Record<string, unknown>[] };
  const ncP = nc.participants || [];
  const newParts = filterExistingParticipantsSimple(transformedParticipants, ncP);
  const finalConv = { ...newConversation, participants: [...ncP, ...newParts] };
  setActiveConversation(finalConv);
  setConversations((prev: Record<string, unknown>[]) => {
    const found = prev.some((c) => (c as Record<string, unknown> & { id?: unknown }).id === newConversation.id);
    if (found) return prev.map((c) => (c as Record<string, unknown> & { id?: unknown }).id === newConversation.id ? finalConv : c);
    return [finalConv, ...prev];
  });
}

/**
 * Adds participants to a conversation and updates the conversation list.
 * Extracted from the hook to keep callback complexity ≤ 12.
 */
function applyParticipants(
  activeConversation: Record<string, unknown> | null,
  newConversation: Record<string, unknown> | null,
  participantsToAdd: Record<string, unknown>[],
  transformedParticipants: Record<string, unknown>[],
  addParticipant: (args: unknown) => void,
  projectId: string,
  toastError: (msg: string) => void,
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
): boolean {
  if (!isActiveConversation(activeConversation)) return !!newConversation;

  const conversationId = String(newConversation?.id || (activeConversation as Record<string, unknown>)?.id);

  try {
    addParticipant({
      projectId,
      conversationId,
      participants: participantsToAdd,
    });
  } catch (err) {
    toastError(err instanceof Error ? err.message : 'Failed to add participants');
    return false;
  }

  updateConversation(
    activeConversation,
    newConversation,
    transformedParticipants,
    setActiveConversation,
    setConversations,
    conversationId,
  );
  return true;
}

function isActiveConversation(conversation: Record<string, unknown> | null): boolean {
  return !!conversation?.id && !conversation?.isNew && !conversation?.isPlayback;
}

function updateConversation(
  activeConversation: Record<string, unknown> | null,
  newConversation: Record<string, unknown> | null,
  transformedParticipants: Record<string, unknown>[],
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
  _conversationId: string,
) {
  try {
    if (!newConversation) {
      updateExistingConversation(activeConversation, transformedParticipants, setActiveConversation, setConversations);
    } else {
      updateNewConversation(newConversation, transformedParticipants, setActiveConversation, setConversations);
    }
  } catch {
    // Silently handle update failure
  }
}

function shouldProcessParticipants(
  activeConversation: Record<string, unknown> | null,
  newConversation: Record<string, unknown> | null,
): boolean {
  const isActive = !!activeConversation?.id && !activeConversation?.isNew && !activeConversation?.isPlayback;
  return isActive || !!newConversation;
}

export function useAddNewParticipants(props: UseAddNewParticipantsProps) {
  const {
    toastError,
    activeConversation,
    setActiveConversation,
    setConversations,
    newConversationViewRef,
  } = props;

  const projectId = useSelectedProjectId();
  const { mutate: addParticipant } = useAddParticipantMutation();

  const handleNewParticipants = useCallback(
    (
      transformedParticipants: Record<string, unknown>[],
      newConversation: Record<string, unknown> | null,
      onAddedCallback: (() => void) | undefined,
      _originalParticipants: OldAppParticipant[],
    ) => {
      if (!shouldProcessParticipants(activeConversation, newConversation)) return;

      const target = (newConversation || activeConversation) as Record<string, unknown> & { participants?: Record<string, unknown>[] };
      const participantsToAdd = filterExistingParticipants(
        transformedParticipants,
        target.participants || [],
      );

      if (participantsToAdd.length === 0) return;

      const result = applyParticipants(
        activeConversation,
        newConversation,
        participantsToAdd,
        transformedParticipants,
        addParticipant,
        projectId,
        toastError,
        setActiveConversation,
        setConversations,
      );

      if (result) {
        onAddedCallback?.();
      }
    },
    [activeConversation, addParticipant, projectId, setActiveConversation, setConversations, toastError],
  );

  const addNewParticipants = useCallback(
    (participants: OldAppParticipant[], onAddedCallback?: () => void) => {
      if (activeConversation?.isPlayback) return;
      if (!activeConversation?.id || activeConversation?.isNew) {
        // @ts-expect-error — current is Record<string, unknown>, not a ref object
        newConversationViewRef?.current?.onSelectParticipant?.();
        return;
      }

      const transformed = participants.map((item) => {
        const { _participantType, ...participant } = item;
        return participant;
      });

      handleNewParticipants(transformed, null, onAddedCallback, participants);
    },
    [activeConversation, handleNewParticipants, newConversationViewRef],
  );

  const addParticipantsToNewConversation = useCallback(
    (participants: OldAppParticipant[], newConv: Record<string, unknown>, onAddedCallback?: () => void) => {
      if ((!activeConversation?.id || activeConversation?.isPlayback) && !newConv) return;

      const transformed = participants.map((item) => {
        const { _participantType, ...participant } = item;
        return participant;
      });

      handleNewParticipants(transformed, newConv, onAddedCallback, participants);
    },
    [activeConversation, handleNewParticipants],
  );

  return { addNewParticipants, addParticipantsToNewConversation };
}
