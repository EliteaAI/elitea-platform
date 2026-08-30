import { useCallback, useEffect, useRef, useState } from 'react';

import type { Participant } from '@/entities/participant';
import { useAddParticipantMutation, useDeleteParticipantMutation } from '@/entities/participant';
import { useFetchParticipantDetails } from '@/features/chat-participants';

import type { CreatedConversation, ParticipantSelectionRuntime } from './useAddEntityParticipant.helpers';
import {
  applyParticipantSelection,
  canBecomeActive,
  findSelectedConversationParticipant,
  isToolkitSelection,
  selectedParticipantInput,
  selectionKey,
} from './useAddEntityParticipant.helpers';
import { useStableRef } from './useStableRef';

export { findSelectedConversationParticipant, selectedParticipantInput };

const EMPTY_PARTICIPANTS: readonly Participant[] = [];

interface ParticipantMenuState {
  readonly checked?: boolean;
  readonly pending?: boolean;
}

interface EntityParticipantActions {
  readonly onSelectParticipant: (selection: unknown) => void;
  readonly getParticipantMenuState: (selection: unknown) => ParticipantMenuState;
}

/** Applies the current UI selection rules to one conversation — creating it first when the chat is still new. */
export function useAddEntityParticipant(params: {
  readonly projectId: string | number | undefined;
  readonly conversationId: string | number | undefined;
  readonly participants?: readonly Participant[] | undefined;
  readonly onChangeParticipant?: ((participant: unknown) => void) | undefined;
  /** Persists the conversation a brand-new chat does not have yet — see the helpers module's `applyParticipantSelection`. */
  readonly createConversation?: (() => Promise<CreatedConversation | undefined>) | undefined;
  readonly onConversationCreated?: ((conversation: CreatedConversation) => void) | undefined;
}): EntityParticipantActions {
  const participants = params.participants ?? EMPTY_PARTICIPANTS;
  const { mutateAsync: addParticipant } = useAddParticipantMutation();
  const { mutateAsync: deleteParticipant } = useDeleteParticipantMutation();
  const { fetchOriginalDetails } = useFetchParticipantDetails();
  const pendingRef = useRef<Set<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());

  const runtimeRef = useStableRef<ParticipantSelectionRuntime & { readonly participants: readonly Participant[] }>({
    projectId: params.projectId,
    conversationId: params.conversationId,
    participants,
    onChangeParticipant: params.onChangeParticipant,
    addParticipant,
    deleteParticipant,
    fetchDetails: fetchOriginalDetails,
    createConversation: params.createConversation,
    onConversationCreated: params.onConversationCreated,
  });

  useEffect(() => {
    if (pendingRef.current.size === 0) return;
    pendingRef.current = new Set();
    setPendingKeys(new Set());
  }, [participants]);

  const clearPending = useCallback((key: string) => {
    pendingRef.current.delete(key);
    setPendingKeys(new Set(pendingRef.current));
  }, []);

  const onSelectParticipant = useCallback((selection: unknown) => {
    const runtime = runtimeRef.current;
    // A conversation is no longer required to start: `applyParticipantSelection`
    // creates one. Only the project is, because it is half the route.
    if (runtime.projectId === undefined) return;
    const key = selectionKey(selection);
    if (!selectedParticipantInput(selection) || !key || pendingRef.current.has(key)) return;

    const existing = findSelectedConversationParticipant(selection, runtime.participants);
    // Re-picking an attached agent selects it; re-picking an attached toolkit
    // detaches it. Neither reaches the network for the agent case, so pending
    // is not entered — nothing would ever clear it.
    if (existing && !isToolkitSelection(selection)) {
      if (canBecomeActive(existing)) runtime.onChangeParticipant?.(existing);
      return;
    }

    pendingRef.current.add(key);
    setPendingKeys(new Set(pendingRef.current));
    // Cleared on EVERY settlement, not just a rejection: `applyParticipantSelection`
    // resolves without adding anything on several paths (the selection carried no
    // participant input, no conversation could be created), and the only other
    // release is the `participants` effect above — which cannot fire when nothing
    // was attached. A resolved no-op therefore used to leave the row disabled for
    // the whole session. The key is still held for the entire flight, which is
    // what the double-click guard needs.
    void applyParticipantSelection(selection, existing, runtime)
      .catch((error: unknown) => {
        console.error('[ChatBox] could not update the selected participant:', error);
      })
      .finally(() => { clearPending(key); });
  }, [clearPending, runtimeRef]);

  const getParticipantMenuState = useCallback((selection: unknown): ParticipantMenuState => {
    const key = selectionKey(selection);
    return {
      ...(isToolkitSelection(selection) ? { checked: findSelectedConversationParticipant(selection, participants) !== undefined } : {}),
      ...(key !== undefined && pendingKeys.has(key) ? { pending: true } : {}),
    };
  }, [participants, pendingKeys]);

  return { onSelectParticipant, getParticipantMenuState };
}
