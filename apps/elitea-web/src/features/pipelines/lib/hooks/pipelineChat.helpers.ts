import { ROLES, WELCOME_MESSAGE_ID } from '@/shared/lib/enums';
import type { Participant } from '@/entities/participant';

import type { PipelineChatSwitchVersionInput } from './usePipelineChatSwitchVersion';
import type { ChatPipelineVersionDetails, ChatConversation, ChatHistoryMessage } from './pipelineChat.types';

/**
 * Pure helpers extracted out of `usePipelineChat.hooks.ts` (both to keep
 * that file's `usePipelineChat` function under this codebase's
 * `complexity`/`max-lines` gates, AND because these ARE genuinely pure — no
 * hook, no closure over component state), mirroring
 * `features/agents/lib/hooks/applicationChat.helpers.ts`'s own identical
 * split for the sibling baseline hook.
 */

// Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/chat.
// helpers.js:7-22` (`getWelcomeMessage`/`getInitialChatHistory`). Duplicated
// locally, NOT imported from `features/chat` (that slice does not exist in
// this app) — same duplication `applicationChat.helpers.ts` already made
// for the identical baseline functions.

export function getWelcomeMessage(welcomeMessage: string, participantId?: string | number | null): ChatHistoryMessage {
  return {
    id: WELCOME_MESSAGE_ID,
    role: ROLES.Assistant,
    content: welcomeMessage,
    isLoading: false,
    isStreaming: false,
    created_at: new Date().getTime(),
    ...(participantId ? { participant_id: participantId } : {}),
  };
}

export function getInitialChatHistory(
  welcomeMessage: string | undefined,
  participantId?: string | number | null,
): ChatHistoryMessage[] {
  if (welcomeMessage) {
    return [getWelcomeMessage(welcomeMessage, participantId)];
  }
  return [];
}

/** `usePipelineChat.hooks.js`'s `pipelineParticipant` `useMemo` body, extracted as a standalone pure function. */
export function buildPipelineParticipant(
  pipelineId: string | number | undefined,
  pipelineName: string | undefined,
  pipelineVersionDetails: ChatPipelineVersionDetails | undefined,
  projectId: string | undefined,
): Participant | null {
  if (pipelineId === undefined || !pipelineVersionDetails) return null;

  return {
    id: String(pipelineId),
    entityName: 'application',
    entityMeta: {
      id: String(pipelineId),
      ...(pipelineName !== undefined ? { name: pipelineName } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    },
    entitySettings: {
      ...(pipelineVersionDetails.variables !== undefined ? { variables: pipelineVersionDetails.variables } : {}),
      ...(pipelineVersionDetails.id !== undefined ? { versionId: pipelineVersionDetails.id } : {}),
      iconMeta: pipelineVersionDetails.meta?.icon_meta ?? {},
      ...(pipelineVersionDetails.agent_type ? { agentType: pipelineVersionDetails.agent_type } : {}),
    },
    ...(pipelineName !== undefined ? { meta: { name: pipelineName } } : {}),
  };
}

/** The `llm_settings` object both `handleCreateConversationOnFirstMessage` and `handleMessage` fall back to when the caller's `eventPayload` doesn't already carry one. */
export function buildLlmSettingsFallback(
  pipelineVersionDetails: ChatPipelineVersionDetails | undefined,
): Readonly<Record<string, unknown>> {
  return {
    model_name: pipelineVersionDetails?.llm_settings?.model_name,
    model_project_id: pipelineVersionDetails?.llm_settings?.model_project_id,
    max_tokens: pipelineVersionDetails?.llm_settings?.max_tokens,
    temperature: pipelineVersionDetails?.llm_settings?.temperature,
    reasoning_effort: pipelineVersionDetails?.llm_settings?.reasoning_effort,
  };
}

/** The `activeParticipantDetails` return-value ternary, extracted so `usePipelineChat`'s own return statement stays a flat object literal. */
export function buildActiveParticipantDetails(
  pipelineId: string | number | undefined,
  pipelineName: string | undefined,
  pipelineVersionDetails: ChatPipelineVersionDetails | undefined,
  projectId: string | undefined,
): Readonly<Record<string, unknown>> | null {
  if (!pipelineVersionDetails) return null;
  return {
    id: pipelineId,
    name: pipelineName,
    description: pipelineVersionDetails.description ?? '',
    participantType: 'application',
    agent_type: pipelineVersionDetails.agent_type ?? 'pipeline',
    version_details: pipelineVersionDetails,
    project_id: projectId,
  };
}

/** Whether a chat-history row currently counts as "in flight" — the shared predicate `isStreaming`/`onStopAll` both filter on. */
export function isMessageInFlight(msg: Pick<ChatHistoryMessage, 'isStreaming' | 'isLoading' | 'isRegenerating'>): boolean {
  return Boolean(msg.isStreaming || msg.isLoading || msg.isRegenerating);
}

function numericConversationId(activeConversation: ChatConversation | null): number {
  return typeof activeConversation?.id === 'number' ? activeConversation.id : 0;
}

function numericParticipantId(activeParticipant: Participant | null): number {
  return typeof activeParticipant?.id === 'string' ? Number(activeParticipant.id) : 0;
}

function switchVersionId(
  activeConversation: ChatConversation | null,
  activeParticipant: Participant | null,
  pipelineVersionDetails: ChatPipelineVersionDetails | undefined,
): string | number | undefined {
  const conversationReady = activeConversation?.id !== undefined && activeParticipant?.id !== undefined;
  return conversationReady ? pipelineVersionDetails?.id : undefined;
}

/**
 * Builds the `useAutoSwitchPipelineChatVersion` input from `usePipelineChat`'s
 * own state — extracted purely to keep that function's own `complexity`
 * count under this codebase's gate. `versionId` stays `undefined` (no-op)
 * until BOTH a conversation and its pipeline participant are resolved, so
 * the FIRST version is never mistaken for a "switch".
 */
export function buildSwitchVersionInput(
  projectId: string | undefined,
  activeConversation: ChatConversation | null,
  activeParticipant: Participant | null,
  pipelineVersionDetails: ChatPipelineVersionDetails | undefined,
): PipelineChatSwitchVersionInput {
  return {
    projectId: projectId ?? '',
    conversationId: numericConversationId(activeConversation),
    participantId: numericParticipantId(activeParticipant),
    activeEntitySettings: activeParticipant?.entitySettings as Readonly<Record<string, unknown>> | undefined,
    versionId: switchVersionId(activeConversation, activeParticipant, pipelineVersionDetails),
    variables: pipelineVersionDetails?.variables,
    llmSettings: pipelineVersionDetails?.llm_settings,
    iconMeta: pipelineVersionDetails?.meta?.icon_meta,
  };
}

/** Merges a version-switch response's `entitySettings` into the active participant — the `onSwitched` callback body. */
export function mergeSwitchedEntitySettings(
  prev: Participant | null,
  entitySettings: Readonly<Record<string, unknown>>,
): Participant | null {
  return prev ? { ...prev, entitySettings } : prev;
}
