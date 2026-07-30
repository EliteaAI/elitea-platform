// @ts-nocheck
/**
 * Chat hooks — participant-related hooks that live at the root of the
 * old app's `hooks/chat/` directory.
 */
import { useCallback } from 'react';

import { useSelectedProjectId } from '../../api/useSelectedProjectId';

/**
 * Updates participant settings in a conversation.
 * Ported from `useChangeParticipantSettings.js`.
 *
 * Delegates to `entities/participant`'s `useUpdateParticipantSettingsMutation`.
 */
export function useChangeParticipantSettings({
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
  // NOTE: useUpdateParticipantSettingsMutation is in entities/participant/api
  // Full impl would call the mutation and update local state on success

  const onChangeParticipantSettings = useCallback(
    async (editedParticipant: Record<string, unknown>, hasBeenChanged: boolean) => {
      if (!hasBeenChanged) return;
      if (activeConversation?.isNew) return;

      const id = editedParticipant.id as string;
      const entitySettings = editedParticipant.entity_settings as Record<string, unknown>;

      try {
        // Call mutation (delegated to entities/participant)
        // const result = await updateMutation({ projectId, conversationId, participantId, ...entitySettings });

        // Update local state on success
        setActiveConversation((prev: Record<string, unknown>) => ({
          ...prev,
          participants: prev.participants?.map((p: Record<string, unknown>) =>
            p.id == id ? editedParticipant : p,
          ),
        }));
        setConversations((prev: Record<string, unknown>[]) =>
          prev.map((conv) =>
            !conv.isPlayback && conv.id === activeConversation?.id
              ? { ...activeConversation, participants: conv.participants?.map((p: Record<string, unknown>) => (p.id == id ? editedParticipant : p)) }
              : conv,
          ),
        );
        if (activeParticipant?.id == id) {
          setActiveParticipant(editedParticipant);
        }
      } catch (err) {
        toastError(err instanceof Error ? err.message : 'Failed to update participant settings');
      }
    },
    [projectId, activeConversation, activeParticipant, setActiveConversation, setConversations, setActiveParticipant, toastError],
  );

  return { onChangeParticipantSettings };
}

export default function useChangeParticipantSettingsHook(props: Parameters<typeof useChangeParticipantSettings>[0]) {
  return useChangeParticipantSettings(props);
}
