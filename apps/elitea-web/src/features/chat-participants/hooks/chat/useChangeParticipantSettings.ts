// @ts-nocheck
/**
 * Chat hooks — participant-related hooks that live at the root of the
 * old app's `hooks/chat/` directory.
 */
import { useCallback } from 'react';

import { useUpdateParticipantSettingsMutation } from '@/entities/participant';
import { useSelectedProjectId } from '../../api/useSelectedProjectId';

/**
 * Updates participant settings in a conversation.
 * Ported from `useChangeParticipantSettings.js`.
 *
 * Delegates to `entities/participant`'s `useUpdateParticipantSettingsMutation`
 * for the actual API call, then updates local state on success.
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
  const { mutate } = useUpdateParticipantSettingsMutation();

  const onChangeParticipantSettings = useCallback(
    (editedParticipant: Record<string, unknown>, hasBeenChanged: boolean) => {
      if (!hasBeenChanged) return;
      if (!activeConversation?.id || activeConversation?.isNew) return;

      const id = String(editedParticipant.id);
      const entitySettings = (editedParticipant.entity_settings as Record<string, unknown>) || {};

      // Update local state optimistically
      setActiveConversation((prev: Record<string, unknown>) => ({
        ...prev,
        participants: prev.participants?.map((p: Record<string, unknown>) =>
          String(p.id) === id ? editedParticipant : p,
        ),
      }));
      setConversations((prev: Record<string, unknown>[]) =>
        prev.map((conv) =>
          !conv.isPlayback && String(conv.id) === String(activeConversation?.id)
            ? { ...conv, participants: conv.participants?.map((p: Record<string, unknown>) => (String(p.id) === id ? editedParticipant : p)) }
            : conv,
        ),
      );
      if (activeParticipant?.id === id || String(activeParticipant?.id) === id) {
        setActiveParticipant(editedParticipant);
      }

      // Send the mutation to the backend
      mutate(
        {
          projectId,
          conversationId: String(activeConversation?.id as string),
          participantId: id,
          settings: entitySettings,
        },
        {
          onError: (err) => {
            toastError(err instanceof Error ? err.message : 'Failed to update participant settings');
          },
        },
      );
    },
    [projectId, activeConversation, activeParticipant, setActiveConversation, setConversations, setActiveParticipant, mutate, toastError],
  );

  return { onChangeParticipantSettings };
}

export default function useChangeParticipantSettingsHook(props: Parameters<typeof useChangeParticipantSettings>[0]) {
  return useChangeParticipantSettings(props);
}
