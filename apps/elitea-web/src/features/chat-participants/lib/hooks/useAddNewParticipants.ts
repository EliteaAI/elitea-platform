// @ts-nocheck
import { useCallback, useMemo } from 'react';

import { ChatParticipantType } from '../../model/constants';
import type { ModelItem, OldAppParticipant } from '../../model/types';

import {
  useAddParticipantMutation,
} from '@/entities/participant';
import { useSelectedProjectId } from '../../api/useSelectedProjectId';

// ---------------------------------------------------------------------------
// useAddNewParticipants
// ---------------------------------------------------------------------------

export interface UseAddNewParticipantsProps {
  toastError: (msg: string) => void;
  activeConversation: Record<string, unknown> | null;
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void;
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void;
  newConversationViewRef?: React.MutableRefObject<Record<string, unknown> | null>;
}

/**
 * Hook that adds new participants to a chat conversation.
 * Ported from `useAddNewParticipants.hooks.js`.
 */
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
  const updateApplicationVersionHook: any = {} as any;

  // Default model resolution (ListModels gap)
  const defaultModel = useMemo<ModelItem | null>(() => null, []);

  const handleNewParticipants = useCallback(
    async (
      transformedParticipants: Record<string, unknown>[],
      newConversation: Record<string, unknown> | null,
      onAddedCallback: (() => void) | undefined,
      originalParticipants: OldAppParticipant[],
    ) => {
      const isActive = !!activeConversation?.id && !activeConversation?.isNew && !activeConversation?.isPlayback;
      if (!isActive && !newConversation) return;

      // Filter participants that are already in the conversation
      const existingParticipants = (newConversation || activeConversation) as Record<string, unknown> & { participants?: Record<string, unknown>[] };
      const participantsToAdd = transformedParticipants.filter((p) => {
        // @ts-expect-error — existing.entity_meta is Record<string, unknown>
        return !existingParticipants.participants?.some((existing) => existing.entity_meta?.id === p.entity_meta?.id);
      });

      if (participantsToAdd.length === 0) return;

      // Save LLM settings for agents/pipelines without a model
      const agentOrPipelineWithoutLLM = originalParticipants.filter((p) => {
        const type = p.entity_name as ChatParticipantType;
        const vd = p.version_details as Record<string, unknown> | undefined;
        return (
          (type === ChatParticipantType.Applications || type === ChatParticipantType.Pipelines) &&
          // @ts-expect-error — vd.llm_settings is Record<string, unknown>
          !vd?.llm_settings?.model_name
        );
      });

      for (const element of agentOrPipelineWithoutLLM) {
        const vd = element.version_details as Record<string, unknown> | undefined;
        await updateApplicationVersionHook({
          projectId,
          applicationId: String(element.id),
          versionId: Number(vd?.id),
          ...(vd || {}),
          llm_settings: {
            ...(vd?.llm_settings || {}),
            model_name: defaultModel?.name,
            model_project_id: defaultModel?.project_id,
          },
        });
      }

      try {
        await addParticipant({
          projectId,
          conversationId: String(newConversation?.id || (activeConversation as Record<string, unknown>)?.id),
          participants: participantsToAdd,
        } as any);
      } catch (err) {
        toastError(err instanceof Error ? err.message : 'Failed to add participants');
        return;
      }

      try {
        const updatedParticipants = transformedParticipants;

        if (!newConversation) {
          setActiveConversation((prev: Record<string, unknown>) => {
            if (!prev?.id) return prev;
            const prevP = (prev as Record<string, unknown> & { participants?: Record<string, unknown>[] }).participants || [];
            const newParts = updatedParticipants.filter(
              (updated: Record<string, unknown>) =>
                !prevP.find(
                  (p: Record<string, unknown>) =>
                    // @ts-expect-error — p.entity_meta is Record<string, unknown>
                    p.entity_meta?.id === updated.entity_meta?.id && p.entity_meta?.project_id === updated.entity_meta?.project_id,
                ),
            );
            return { ...prev, participants: [...prevP, ...newParts] };
          });
          setConversations((prev: Record<string, unknown>[]) =>
            prev.map((conv: Record<string, unknown>) =>
              (conv as Record<string, unknown> & { id?: unknown }).id === (activeConversation as Record<string, unknown>)?.id
                ? { ...conv, participants: [ ...((conv as Record<string, unknown> & { participants?: Record<string, unknown>[] }).participants || []), ...updatedParticipants] }
                : conv,
            ),
          );
        } else {
          const nc = newConversation as Record<string, unknown> & { participants?: Record<string, unknown>[] };
          const ncP = nc.participants || [];
          const newParts = updatedParticipants.filter(
            (updated: Record<string, unknown>) =>
              !ncP.some(
                // @ts-expect-error — p and updated.entity_meta are Record<string, unknown>
                (p: Record<string, unknown>) => p.entity_meta?.id === updated.entity_meta?.id,
              ),
          );
          const finalNewConversation = {
            ...newConversation,
            participants: [...ncP, ...newParts],
          };
          setActiveConversation(finalNewConversation);
          setConversations((prev: Record<string, unknown>[]) => {
            const found = prev.some((c: Record<string, unknown>) => (c as Record<string, unknown> & { id?: unknown }).id === newConversation.id);
            if (found) return prev.map((c: Record<string, unknown>) => (c as Record<string, unknown> & { id?: unknown }).id === newConversation.id ? finalNewConversation : c);
            return [finalNewConversation, ...prev];
          });
        }
        onAddedCallback?.();
      } catch {
        // Silently handle update failure
      }
    },
    [activeConversation, addParticipant, defaultModel, projectId, setActiveConversation, setConversations, updateApplicationVersionHook],
  );

  const addNewParticipants = useCallback(
    async (participants: OldAppParticipant[], onAddedCallback?: () => void) => {
      if (activeConversation?.isPlayback) return;
      if (!activeConversation?.id || activeConversation?.isNew) {
        // @ts-expect-error — current is Record<string, unknown>, not a ref object
        newConversationViewRef?.current?.onSelectParticipant?.();
        return;
      }

      const transformed = participants.map((item) => {
        const { participantType, ...participant } = item;
        return participant;
      });

      await handleNewParticipants(transformed, null, onAddedCallback, participants);
    },
    [activeConversation, handleNewParticipants, newConversationViewRef],
  );

  const addParticipantsToNewConversation = useCallback(
    async (participants: OldAppParticipant[], newConv: Record<string, unknown>, onAddedCallback?: () => void) => {
      if ((!activeConversation?.id || activeConversation?.isPlayback) && !newConv) return;

      const transformed = participants.map((item) => {
        const { participantType, ...participant } = item;
        return participant;
      });

      await handleNewParticipants(transformed, newConv, onAddedCallback, participants);
    },
    [activeConversation, handleNewParticipants],
  );

  return { addNewParticipants, addParticipantsToNewConversation };
}
