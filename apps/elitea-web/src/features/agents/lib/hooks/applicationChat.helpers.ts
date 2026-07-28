import { ROLES, WELCOME_MESSAGE_ID } from '@/shared/lib/enums';
import type { Participant } from '@/entities/participant';
import type { ApplicationChatSwitchVersionInput } from '../../model/useApplicationChatSwitchVersion';

import type { ChatApplicationVersionDetails, ChatConversation, ChatHistoryMessage } from './applicationChat.types';

/**
 * Pure helpers extracted out of `useApplicationChat.hooks.ts` (both to keep
 * that file's `useApplicationChat` function under this codebase's
 * `complexity`/`max-lines` gates, AND because these ARE genuinely pure —
 * no hook, no closure over component state).
 */

// ── Local welcome-message helpers ───────────────────────────────────────────
// Ported from `apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/chat.
// helpers.js:7-22` (`getWelcomeMessage`/`getInitialChatHistory`). Duplicated
// locally, NOT imported from `features/chat`: that slice does not exist in
// this app yet, and `no-sideways-features` would forbid the import even if
// it did. Two small pure functions with no further dependency beyond the
// shared `ROLES`/`WELCOME_MESSAGE_ID` enums (already ported to
// `shared/lib/enums.ts`, unit S3) — same class of small, disclosed cross-
// boundary duplication this codebase already accepts elsewhere (see
// `features/agents/lib/mcpType.ts`'s own doc comment).

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

/** `useApplicationChat.hooks.js`'s `applicationParticipant` `useMemo` body, extracted as a standalone pure function. */
export function buildApplicationParticipant(
  applicationId: string | number | undefined,
  applicationName: string | undefined,
  applicationVersionDetails: ChatApplicationVersionDetails | undefined,
  projectId: string | undefined,
): Participant | null {
  if (applicationId === undefined || !applicationVersionDetails) return null;

  return {
    id: String(applicationId),
    entityName: 'application',
    entityMeta: {
      id: String(applicationId),
      ...(applicationName !== undefined ? { name: applicationName } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    },
    entitySettings: {
      ...(applicationVersionDetails.variables !== undefined ? { variables: applicationVersionDetails.variables } : {}),
      ...(applicationVersionDetails.id !== undefined ? { versionId: applicationVersionDetails.id } : {}),
      iconMeta: applicationVersionDetails.meta?.icon_meta ?? {},
      ...(applicationVersionDetails.agent_type ? { agentType: applicationVersionDetails.agent_type } : {}),
    },
    ...(applicationName !== undefined ? { meta: { name: applicationName } } : {}),
  };
}

/** The `llm_settings` object both `handleCreateConversationOnFirstMessage` and `handleMessage` fall back to when the caller's `eventPayload` doesn't already carry one. */
export function buildLlmSettingsFallback(
  applicationVersionDetails: ChatApplicationVersionDetails | undefined,
): Readonly<Record<string, unknown>> {
  return {
    model_name: applicationVersionDetails?.llm_settings?.model_name,
    model_project_id: applicationVersionDetails?.llm_settings?.model_project_id,
    max_tokens: applicationVersionDetails?.llm_settings?.max_tokens,
    temperature: applicationVersionDetails?.llm_settings?.temperature,
    reasoning_effort: applicationVersionDetails?.llm_settings?.reasoning_effort,
  };
}

/** The `activeParticipantDetails` return-value ternary, extracted so `useApplicationChat`'s own return statement stays a flat object literal. */
export function buildActiveParticipantDetails(
  applicationId: string | number | undefined,
  applicationName: string | undefined,
  applicationVersionDetails: ChatApplicationVersionDetails | undefined,
  projectId: string | undefined,
): Readonly<Record<string, unknown>> | null {
  if (!applicationVersionDetails) return null;
  return {
    id: applicationId,
    name: applicationName,
    description: applicationVersionDetails.description ?? '',
    participantType: 'application',
    agent_type: applicationVersionDetails.agent_type,
    version_details: applicationVersionDetails,
    project_id: projectId,
  };
}

/** Whether a chat-history row currently counts as "in flight" — the shared predicate `isStreaming`/`onStopAll` both filter on. */
export function isMessageInFlight(msg: Pick<ChatHistoryMessage, 'isStreaming' | 'isLoading' | 'isRegenerating'>): boolean {
  return Boolean(msg.isStreaming || msg.isLoading || msg.isRegenerating);
}

/**
 * Builds the `useAutoSwitchApplicationChatVersion` input from
 * `useApplicationChat`'s own state — extracted purely to keep that
 * function's own `complexity` count under this codebase's gate (every
 * `?.`/`??`/ternary below moves out of the hook body into this standalone,
 * independently-testable function). `versionId` stays `undefined` (no-op)
 * until BOTH a conversation and its application participant are resolved,
 * so the FIRST version is never mistaken for a "switch" — matching the
 * baseline's own `prevVersionId` seeding from the version present at mount.
 */
function numericConversationId(activeConversation: ChatConversation | null): number {
  return typeof activeConversation?.id === 'number' ? activeConversation.id : 0;
}

function numericParticipantId(activeParticipant: Participant | null): number {
  return typeof activeParticipant?.id === 'string' ? Number(activeParticipant.id) : 0;
}

function switchVersionId(
  activeConversation: ChatConversation | null,
  activeParticipant: Participant | null,
  applicationVersionDetails: ChatApplicationVersionDetails | undefined,
): string | number | undefined {
  const conversationReady = activeConversation?.id !== undefined && activeParticipant?.id !== undefined;
  return conversationReady ? applicationVersionDetails?.id : undefined;
}

export function buildSwitchVersionInput(
  projectId: string | undefined,
  activeConversation: ChatConversation | null,
  activeParticipant: Participant | null,
  applicationVersionDetails: ChatApplicationVersionDetails | undefined,
): ApplicationChatSwitchVersionInput {
  return {
    projectId: projectId ?? '',
    conversationId: numericConversationId(activeConversation),
    participantId: numericParticipantId(activeParticipant),
    activeEntitySettings: activeParticipant?.entitySettings as Readonly<Record<string, unknown>> | undefined,
    versionId: switchVersionId(activeConversation, activeParticipant, applicationVersionDetails),
    variables: applicationVersionDetails?.variables,
    llmSettings: applicationVersionDetails?.llm_settings,
    iconMeta: applicationVersionDetails?.meta?.icon_meta,
  };
}

/** Merges a version-switch response's `entitySettings` into the active participant — the `onSwitched` callback body, extracted for the same reason as `buildSwitchVersionInput`. */
export function mergeSwitchedEntitySettings(
  prev: Participant | null,
  entitySettings: Readonly<Record<string, unknown>>,
): Participant | null {
  return prev ? { ...prev, entitySettings } : prev;
}
