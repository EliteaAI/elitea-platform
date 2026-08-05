// @ts-nocheck
/**
 * DISCLOSED GAP — old-app's default-LLM-settings-before-add behaviour
 * (`useAddNewParticipants.hooks.js:47-69`: before adding an Applications/
 * Pipelines participant whose `version_details.llm_settings.model_name` is
 * missing, fetch the project's models via `useListModelsQuery` and persist a
 * default `model_name`/`model_project_id` onto that version via
 * `useUpdateApplicationVersionMutation` BEFORE calling `addParticipant`) is
 * NOT ported here. There is no `ListModels`-shaped endpoint anywhere under
 * `shared/api/generated/` — the same gap `features/agents/model/
 * useSaveVersion.ts`'s module doc and `entities/application-form/model/
 * initialValues.ts` already disclose for their own, narrower `llm_settings`
 * needs. `features/chat-input/api/models.ts` and `features/credentials/api/
 * configurationConnections.ts` both hit the real `/configurations/models/
 * {projectId}` route, but the former is section-locked to `asr`/`tts` (not
 * general LLM models) and the latter is a `features/credentials` internal
 * `no-sideways-features` forbids importing from a sibling feature. Per this
 * codebase's own established precedent (two units already disclosed
 * dropping this identical default-model behaviour for this identical
 * reason), it stays a documented drop rather than a third near-duplicate,
 * unpromoted models-listing fetcher. `_originalParticipants` is threaded
 * through unused for this reason; a future unit that promotes a shared
 * `ListModels` primitive can wire it back in here.
 */
import { useCallback } from 'react';

import type { OldAppParticipant } from '../../model/types';

import { ChatParticipantType } from '../../model/constants';
import { getChatParticipantUniqueId, transformParticipant } from '../helpers';

import { conversationApi } from '@/entities/conversation';
import { useAddParticipantMutation } from '@/entities/participant';
import { useSelectedProjectId } from '../../api/useSelectedProjectId';

/** `unknown` id (string or number on the wire) -> comparable string, without relying on a possibly-object `toString`. */
function toIdString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

// ---------------------------------------------------------------------------
// Helper: dedupe by stable participant identity (complexity ≤ 3)
// ---------------------------------------------------------------------------

/**
 * Filters `candidates` down to the ones NOT already present in `existing`,
 * matching on `getChatParticipantUniqueId` — the same identity `old-app`'s
 * `isParticipantsEqual`/`getChatParticipantUniqueId` use, and critically
 * (unlike a plain `entity_meta.id` comparison) correct for `Models`
 * participants, which have no `entity_meta.id` at all (keyed by
 * `model_name`-`integration_uid` instead) — a plain `id` comparison would
 * treat every Models candidate as a duplicate of every other.
 */
function dedupeByUniqueId(
  candidates: Record<string, unknown>[],
  existing: Record<string, unknown>[],
): Record<string, unknown>[] {
  const existingIds = new Set(existing.map((item) => getChatParticipantUniqueId(item)));
  return candidates.filter((candidate) => !existingIds.has(getChatParticipantUniqueId(candidate)));
}

function buildNewParticipants(
  existing: Record<string, unknown>[],
  newItems: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...existing, ...dedupeByUniqueId(newItems, existing)];
}

// ---------------------------------------------------------------------------
// Wire adapter — complexity ≤ 2 per function
// ---------------------------------------------------------------------------

/**
 * `useAddParticipantMutation`'s response is normalised by `entities/
 * participant` (`addParticipantIntoConversation` calls `normaliseParticipants`
 * before returning) to the camelCase `Participant` domain shape. Every other
 * consumer in this cluster — `transformParticipant`, `getChatParticipantUniqueId`,
 * `ParticipantItem.tsx`, this file's own dedupe/merge helpers — works on the
 * raw snake_case wire shape instead, so the mutation's result is converted
 * back here rather than propagating a second, incompatible participant shape
 * through local/UI state (which would also silently drop the server-assigned
 * top-level `id` every by-`id` consumer, e.g. `useDeleteParticipant`, needs).
 */
function renameKeys(
  obj: Record<string, unknown> | undefined,
  keyMap: Record<string, string>,
): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(keyMap)) {
    if (obj[from] !== undefined) out[to] = obj[from];
  }
  return out;
}

const ENTITY_META_KEY_MAP = {
  id: 'id',
  name: 'name',
  projectId: 'project_id',
  modelName: 'model_name',
  integrationUid: 'integration_uid',
};
const META_KEY_MAP = {
  id: 'id',
  name: 'name',
  userName: 'user_name',
  userAvatar: 'user_avatar',
  isContainer: 'is_container',
  mcp: 'mcp',
};
const ENTITY_SETTINGS_KEY_MAP = {
  llmSettings: 'llm_settings',
  versionId: 'version_id',
  variables: 'variables',
  iconMeta: 'icon_meta',
  toolkitType: 'toolkit_type',
  agentType: 'agent_type',
  mcpServerUrl: 'mcp_server_url',
};

function toWireParticipant(participant: Record<string, unknown>): Record<string, unknown> {
  const entityMeta = renameKeys(participant.entityMeta as Record<string, unknown> | undefined, ENTITY_META_KEY_MAP);
  const meta = renameKeys(participant.meta as Record<string, unknown> | undefined, META_KEY_MAP);
  const entitySettings = renameKeys(participant.entitySettings as Record<string, unknown> | undefined, ENTITY_SETTINGS_KEY_MAP);
  return {
    id: participant.id,
    entity_name: participant.entityName,
    ...(entityMeta ? { entity_meta: entityMeta } : {}),
    ...(meta ? { meta } : {}),
    ...(entitySettings ? { entity_settings: entitySettings } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helper: conversation-level merge (complexity ≤ 4 per function)
// ---------------------------------------------------------------------------

function withAttachmentId(conversation: Record<string, unknown>, attachmentParticipantId: unknown): Record<string, unknown> {
  return attachmentParticipantId ? { ...conversation, attachment_participant_id: attachmentParticipantId } : conversation;
}

function updateExistingConversation(
  activeConversation: Record<string, unknown> | null,
  updatedParticipants: Record<string, unknown>[],
  attachmentParticipantId: unknown,
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
) {
  setActiveConversation((prev: Record<string, unknown>) => {
    if (!prev?.id) return prev;
    const prevP = (prev as Record<string, unknown> & { participants?: Record<string, unknown>[] }).participants || [];
    const merged = { ...prev, participants: buildNewParticipants(prevP, updatedParticipants) };
    return withAttachmentId(merged, attachmentParticipantId);
  });
  setConversations((prev: Record<string, unknown>[]) =>
    prev.map((conv) => {
      const convId = (conv as Record<string, unknown> & { id?: unknown; isPlayback?: boolean }).id;
      if (convId !== (activeConversation as Record<string, unknown>)?.id || conv.isPlayback) return conv;
      const convParticipants = (conv as Record<string, unknown> & { participants?: Record<string, unknown>[] }).participants || [];
      const merged = { ...conv, participants: buildNewParticipants(convParticipants, updatedParticipants) };
      return withAttachmentId(merged, attachmentParticipantId);
    }),
  );
}

function updateNewConversation(
  newConversation: Record<string, unknown>,
  updatedParticipants: Record<string, unknown>[],
  attachmentParticipantId: unknown,
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
) {
  const nc = newConversation as Record<string, unknown> & { participants?: Record<string, unknown>[] };
  const ncP = nc.participants || [];
  const finalConv = withAttachmentId({ ...newConversation, participants: buildNewParticipants(ncP, updatedParticipants) }, attachmentParticipantId);
  setActiveConversation(finalConv);
  setConversations((prev: Record<string, unknown>[]) => {
    const found = prev.some((c) => (c as Record<string, unknown> & { id?: unknown }).id === newConversation.id);
    if (found) return prev.map((c) => (c as Record<string, unknown> & { id?: unknown }).id === newConversation.id ? finalConv : c);
    return [finalConv, ...prev];
  });
}

function updateConversation(
  activeConversation: Record<string, unknown> | null,
  newConversation: Record<string, unknown> | null,
  updatedParticipants: Record<string, unknown>[],
  attachmentParticipantId: unknown,
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
) {
  try {
    if (!newConversation) {
      updateExistingConversation(activeConversation, updatedParticipants, attachmentParticipantId, setActiveConversation, setConversations);
    } else {
      updateNewConversation(newConversation, updatedParticipants, attachmentParticipantId, setActiveConversation, setConversations);
    }
  } catch {
    // Silently handle update failure
  }
}

// ---------------------------------------------------------------------------
// Helper: post-add conversation refetch (complexity ≤ 6)
// ---------------------------------------------------------------------------

/**
 * Ported from `useAddNewParticipants.hooks.js:76-111`: when an `Applications`
 * participant was among the ones just added, the server may have
 * auto-created toolkit participants alongside it (and may have set
 * `attachment_participant_id`) — neither is present on the mutation's own
 * response, so a full conversation refetch recovers both. For any other
 * add, the mutation's own (wire-adapted) response is the full answer.
 */
async function computeUpdatedParticipants(
  projectId: string,
  conversationId: string,
  participantsToAdd: Record<string, unknown>[],
  addedParticipants: Record<string, unknown>[],
  targetParticipants: Record<string, unknown>[],
): Promise<{ updatedParticipants: Record<string, unknown>[]; attachmentParticipantId: unknown }> {
  const addedApplication = participantsToAdd.some((p) => p.entity_name === ChatParticipantType.Applications);
  if (!addedApplication) {
    return { updatedParticipants: addedParticipants, attachmentParticipantId: undefined };
  }

  try {
    const conversation = await conversationApi.details({ projectId, id: conversationId });
    const fullParticipants = (conversation.participants as Record<string, unknown>[] | undefined) || [];
    const addedIds = new Set(addedParticipants.map((p) => getChatParticipantUniqueId(p)));
    const existingIds = new Set(targetParticipants.map((p) => getChatParticipantUniqueId(p)));
    const updatedParticipants = fullParticipants.filter((participant) => {
      const uid = getChatParticipantUniqueId(participant);
      const isAutoCreatedToolkit = participant.entity_name === ChatParticipantType.Toolkits && !existingIds.has(uid);
      return addedIds.has(uid) || isAutoCreatedToolkit;
    });
    return { updatedParticipants, attachmentParticipantId: (conversation as Record<string, unknown>).attachment_participant_id };
  } catch {
    return { updatedParticipants: addedParticipants, attachmentParticipantId: undefined };
  }
}

// ---------------------------------------------------------------------------
// Helper: add + merge orchestration (complexity ≤ 6)
// ---------------------------------------------------------------------------

/**
 * Adds participants to a conversation and updates local state — ONLY on a
 * successful, awaited response, matching `useAddNewParticipants.hooks.js:
 * 70-185`. Returns the merged participant list (for `onAddedCallback`) or
 * `undefined` on failure/no-op, so the caller knows whether to fire the
 * callback at all.
 */
async function applyParticipants(
  activeConversation: Record<string, unknown> | null,
  newConversation: Record<string, unknown> | null,
  participantsToAdd: Record<string, unknown>[],
  addParticipant: (args: unknown) => Promise<Record<string, unknown>[]>,
  projectId: string,
  toastError: (msg: string) => void,
  setActiveConversation: (updater: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)) => void,
  setConversations: (updater: Record<string, unknown>[] | ((prev: Record<string, unknown>[]) => Record<string, unknown>[])) => void,
): Promise<Record<string, unknown>[] | undefined> {
  const target = newConversation || activeConversation;
  if (!target) return undefined;

  const conversationId = toIdString(newConversation?.id) || toIdString(activeConversation?.id);

  let addedParticipants: Record<string, unknown>[];
  try {
    const result = await addParticipant({ projectId, conversationId, participants: participantsToAdd });
    addedParticipants = (result || []).map((p) => toWireParticipant(p));
  } catch (err) {
    toastError(err instanceof Error ? err.message : 'Failed to add participants');
    return undefined;
  }

  if (addedParticipants.length === 0) return undefined;

  const targetParticipants = (target.participants as Record<string, unknown>[] | undefined) || [];
  const { updatedParticipants, attachmentParticipantId } = await computeUpdatedParticipants(
    projectId,
    conversationId,
    participantsToAdd,
    addedParticipants,
    targetParticipants,
  );

  updateConversation(activeConversation, newConversation, updatedParticipants, attachmentParticipantId, setActiveConversation, setConversations);

  return updatedParticipants;
}

function shouldProcessParticipants(
  activeConversation: Record<string, unknown> | null,
  newConversation: Record<string, unknown> | null,
): boolean {
  const isActive = !!activeConversation?.id && !activeConversation?.isNew && !activeConversation?.isPlayback;
  return isActive || !!newConversation;
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
export function useAddNewParticipants(props: UseAddNewParticipantsProps) {
  const {
    toastError,
    activeConversation,
    setActiveConversation,
    setConversations,
    newConversationViewRef,
  } = props;

  const projectId = useSelectedProjectId();
  const { mutateAsync: addParticipant } = useAddParticipantMutation();

  const handleNewParticipants = useCallback(
    async (
      transformedParticipants: Record<string, unknown>[],
      newConversation: Record<string, unknown> | null,
      onAddedCallback: ((updatedParticipants?: Record<string, unknown>[]) => void) | undefined,
      _originalParticipants: OldAppParticipant[],
    ) => {
      if (!shouldProcessParticipants(activeConversation, newConversation)) return;

      const target = (newConversation || activeConversation) as Record<string, unknown> & { participants?: Record<string, unknown>[] };
      const participantsToAdd = dedupeByUniqueId(transformedParticipants, target.participants || []);

      if (participantsToAdd.length === 0) return;

      const updatedParticipants = await applyParticipants(
        activeConversation,
        newConversation,
        participantsToAdd,
        addParticipant,
        projectId,
        toastError,
        setActiveConversation,
        setConversations,
      );

      if (updatedParticipants) {
        onAddedCallback?.(updatedParticipants);
      }
    },
    [activeConversation, addParticipant, projectId, setActiveConversation, setConversations, toastError],
  );

  const addNewParticipants = useCallback(
    async (participants: OldAppParticipant[], onAddedCallback?: (updatedParticipants?: Record<string, unknown>[]) => void) => {
      if (activeConversation?.isPlayback) return;
      if (!activeConversation?.id || activeConversation?.isNew) {
        participants.forEach((p) => {
          // @ts-expect-error — current is Record<string, unknown>, not a ref object
          newConversationViewRef?.current?.onSelectParticipant?.(p);
        });
        return;
      }

      const transformed = participants.map((item) => {
        const { participantType, ...participant } = item;
        return transformParticipant(participantType as ChatParticipantType, participant);
      });

      await handleNewParticipants(transformed, null, onAddedCallback, participants);
    },
    [activeConversation, handleNewParticipants, newConversationViewRef],
  );

  const addParticipantsToNewConversation = useCallback(
    async (participants: OldAppParticipant[], newConv: Record<string, unknown>, onAddedCallback?: (updatedParticipants?: Record<string, unknown>[]) => void) => {
      if ((!activeConversation?.id || activeConversation?.isPlayback) && !newConv) return;

      const transformed = participants.map((item) => {
        const { participantType, ...participant } = item;
        return transformParticipant(participantType as ChatParticipantType, participant);
      });

      await handleNewParticipants(transformed, newConv, onAddedCallback, participants);
    },
    [activeConversation, handleNewParticipants],
  );

  return { addNewParticipants, addParticipantsToNewConversation };
}
