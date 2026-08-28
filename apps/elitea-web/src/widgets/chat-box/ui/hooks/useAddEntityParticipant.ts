import { useCallback, useEffect, useRef, useState } from 'react';

import type { Participant } from '@/entities/participant';
import { useAddParticipantMutation, useDeleteParticipantMutation } from '@/entities/participant';
import { ChatParticipantType, transformParticipant } from '@/features/chat-participants';

type CatalogSelection = Readonly<Record<string, unknown>>;
const EMPTY_PARTICIPANTS: readonly Participant[] = [];

interface ParticipantMenuState {
  readonly checked?: boolean;
  readonly pending?: boolean;
}

interface EntityParticipantActions {
  readonly onSelectParticipant: (selection: unknown) => void;
  readonly getParticipantMenuState: (selection: unknown) => ParticipantMenuState;
}

export function selectedParticipantInput(selection: unknown) {
  const candidate = selection as Record<string, unknown>;
  const participantType = candidate['participantType'];
  if (
    participantType !== ChatParticipantType.Applications &&
    participantType !== ChatParticipantType.Pipelines &&
    participantType !== ChatParticipantType.Toolkits
  ) return undefined;
  const transformed = transformParticipant(participantType, candidate);
  return {
    entity_name: transformed.entity_name,
    entity_meta: { ...transformed.entity_meta },
    entity_settings: { ...transformed.entity_settings },
  };
}

function selectionType(selection: CatalogSelection): unknown {
  return selection['participantType'];
}

function participantTypeMatches(participant: Participant, selection: CatalogSelection): boolean {
  const type = selectionType(selection);
  if (type === ChatParticipantType.Pipelines) {
    return participant.entityName === ChatParticipantType.Pipelines ||
      (participant.entityName === ChatParticipantType.Applications && participant.entitySettings?.agentType === 'pipeline');
  }
  if (type === ChatParticipantType.Applications) {
    return participant.entityName === ChatParticipantType.Applications && participant.entitySettings?.agentType !== 'pipeline';
  }
  return type === ChatParticipantType.Toolkits && participant.entityName === ChatParticipantType.Toolkits;
}

export function findSelectedConversationParticipant(
  selection: unknown,
  participants: readonly Participant[],
): Participant | undefined {
  const candidate = selection as CatalogSelection;
  const transformed = selectedParticipantInput(candidate);
  if (!transformed) return undefined;
  const entityId = transformed.entity_meta['id'];
  const projectId = transformed.entity_meta['project_id'];
  return participants.find((participant) =>
    participantTypeMatches(participant, candidate) &&
    String(participant.entityMeta?.id ?? '') === String(entityId ?? '') &&
    String(participant.entityMeta?.projectId ?? '') === String(projectId ?? ''),
  );
}

function selectionKey(selection: unknown): string | undefined {
  const candidate = selection as CatalogSelection;
  const transformed = selectedParticipantInput(candidate);
  if (!transformed) return undefined;
  const entityId = transformed.entity_meta['id'];
  const projectId = transformed.entity_meta['project_id'];
  return `${String(selectionType(candidate))}:${String(entityId ?? '')}:${String(projectId ?? '')}`;
}

function canBecomeActive(participant: Participant): boolean {
  return participant.entityName === ChatParticipantType.Applications ||
    participant.entityName === ChatParticipantType.Pipelines;
}

/** Applies the current UI selection rules to one persisted conversation. */
export function useAddEntityParticipant(params: {
  readonly projectId: string | number | undefined;
  readonly conversationId: string | number | undefined;
  readonly participants?: readonly Participant[] | undefined;
  readonly onChangeParticipant?: ((participant: unknown) => void) | undefined;
}): EntityParticipantActions {
  const { projectId, conversationId, onChangeParticipant } = params;
  const participants = params.participants ?? EMPTY_PARTICIPANTS;
  const { mutateAsync: addParticipant } = useAddParticipantMutation();
  const { mutateAsync: deleteParticipant } = useDeleteParticipantMutation();
  const pendingRef = useRef<Set<string>>(new Set());
  const [pendingKeys, setPendingKeys] = useState<ReadonlySet<string>>(new Set());

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
    if (projectId === undefined || conversationId === undefined) return;
    const participantInput = selectedParticipantInput(selection);
    const key = selectionKey(selection);
    if (!participantInput || !key || pendingRef.current.has(key)) return;

    const existing = findSelectedConversationParticipant(selection, participants);
    const toolkitSelection = (selection as CatalogSelection)['participantType'] === ChatParticipantType.Toolkits;
    if (existing && !toolkitSelection) {
      if (canBecomeActive(existing)) onChangeParticipant?.(existing);
      return;
    }

    pendingRef.current.add(key);
    setPendingKeys(new Set(pendingRef.current));
    const mutation = existing
      ? deleteParticipant({ projectId, conversationId: String(conversationId), id: existing.id })
      : addParticipant({ projectId, conversationId: String(conversationId), participants: [participantInput] })
        .then((updated) => {
          const added = findSelectedConversationParticipant(selection, updated);
          if (added && canBecomeActive(added)) onChangeParticipant?.(added);
        });
    void mutation.catch((error: unknown) => {
      clearPending(key);
      console.error('[ChatBox] could not update the selected participant:', error);
    });
  }, [addParticipant, clearPending, conversationId, deleteParticipant, onChangeParticipant, participants, projectId]);

  const getParticipantMenuState = useCallback((selection: unknown): ParticipantMenuState => {
    const key = selectionKey(selection);
    const toolkitSelection = (selection as CatalogSelection)['participantType'] === ChatParticipantType.Toolkits;
    return {
      ...(toolkitSelection ? { checked: findSelectedConversationParticipant(selection, participants) !== undefined } : {}),
      ...(key !== undefined && pendingKeys.has(key) ? { pending: true } : {}),
    };
  }, [participants, pendingKeys]);

  return { onSelectParticipant, getParticipantMenuState };
}
