// @ts-nocheck
/**
 * AddParticipants helpers — ported from
 * `apps/elitea-ui/src/[fsd]/features/chat/participants/lib/helpers/addParticipants.helpers.js`.
 *
 * IMPORTANT: `getChatParticipantUniqueId`/`getParticipantName` imports are
 * redirected to `entities/participant` (unit C1 port) — do NOT re-port
 * `participants.helpers.js` into this unit.
 */
import { ChatParticipantType } from '../model/constants';

import { chatParticipantUniqueId } from '@/entities/participant';
import type { TransformedParticipant } from '../model/types';

const { Models } = ChatParticipantType;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_REASONING_EFFORT = 'medium';

// ---------------------------------------------------------------------------
// isParticipantOKForChat — ported verbatim from old-app line 8-13
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the participant entity type is valid for inclusion in a
 * chat. Ported from `addParticipants.helpers.js:8-13`.
 */
export function isParticipantOKForChat(participant: { entity_name?: string }): boolean {
  return (
    participant.entity_name === ChatParticipantType.Users ||
    participant.entity_name === ChatParticipantType.Toolkits ||
    participant.entity_name === ChatParticipantType.Applications ||
    participant.entity_name === ChatParticipantType.Pipelines
  );
}

// ---------------------------------------------------------------------------
// canParticipantBeActiveInChat — ported verbatim from old-app line 15-19
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the participant can be selected as the active (LLM)
 * participant in a chat. Ported from `addParticipants.helpers.js:15-19`.
 */
export function canParticipantBeActiveInChat(participant: { entity_name?: string }): boolean {
  return (
    participant.entity_name === ChatParticipantType.Users ||
    participant.entity_name === ChatParticipantType.Applications ||
    participant.entity_name === ChatParticipantType.Pipelines
  );
}

// ---------------------------------------------------------------------------
// extractVariables — extracted from transformParticipant
// ---------------------------------------------------------------------------

/**
 * Extracts the variables array from a participant, checking multiple sources
 * in priority order.
 */
function extractVariables(
  participant: Record<string, unknown>,
  participantType: ChatParticipantType,
  providedVariables: unknown[] | undefined,
): unknown[] {
  return (
    providedVariables ||
    (participant.entity_settings as Record<string, unknown>)?.variables ||
    (participantType === ChatParticipantType.Applications
      ? (participant.version_details as Record<string, unknown>)?.variables
      : undefined) ||
    []
  );
}

// ---------------------------------------------------------------------------
// extractIconMeta — extracted from transformParticipant
// ---------------------------------------------------------------------------

/**
 * Extracts icon metadata from a participant, returning an empty object for
 * toolkit participants.
 */
function extractIconMeta(participant: Record<string, unknown>, participantType: ChatParticipantType): Record<string, unknown> {
  if (participantType === ChatParticipantType.Toolkits) {
    return {};
  }
  return {
    ...((participant.entity_settings as Record<string, any>)?.icon_meta ||
    (participant.meta as Record<string, any>)?.icon_meta ||
    (participant.icon_meta as Record<string, any>)),
  };
}

// ---------------------------------------------------------------------------
// extractVersionId — extracted from transformParticipant
// ---------------------------------------------------------------------------

/**
 * Extracts version_id from a participant, checking multiple sources in
 * priority order.
 */
function extractVersionId(
  participant: Record<string, unknown>,
  participantType: ChatParticipantType,
): { version_id?: string } | undefined {
  const esVersion = (participant.entity_settings as Record<string, any>)?.version_id;
  if (esVersion) {
    return { version_id: esVersion };
  }
  if (participantType === ChatParticipantType.Applications) {
    const vdId = (participant.version_details as Record<string, unknown>)?.id;
    if (vdId) {
      return { version_id: vdId as string };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// extractMc pServerUrl — extracted from transformParticipant
// ---------------------------------------------------------------------------

/**
 * Extracts the MCP server URL from a participant, checking multiple sources
 * in priority order.
 */
function extractMcpServerUrl(participant: Record<string, unknown>): string | undefined {
  return (participant.settings as Record<string, unknown>)?.url ||
    (participant.entity_settings as Record<string, unknown>)?.mcp_server_url ||
    undefined;
}

// ---------------------------------------------------------------------------
// buildNonModelParticipant — extracted from transformParticipant
// ---------------------------------------------------------------------------

/**
 * Builds a non-Model transformed participant.
 */
function buildNonModelParticipant(
  participantType: ChatParticipantType,
  participant: Record<string, unknown>,
  variables?: unknown[],
): TransformedParticipant {
  const entityName = participant.agent_type === 'pipeline'
    ? ChatParticipantType.Applications
    : participantType;

  const entityMeta: Record<string, unknown> = {};
  if (participant.id) entityMeta.id = participant.id;
  if (participant.name) entityMeta.name = participant.name;
  if (participant.project_id) entityMeta.project_id = participant.project_id;

  const entitySettings: Record<string, unknown> = {
    variables: extractVariables(participant, participantType, variables),
    icon_meta: extractIconMeta(participant, participantType),
    toolkit_type: participant.type,
    agent_type: participant.agent_type,
    mcp_server_url: extractMcpServerUrl(participant),
  };

  const versionId = extractVersionId(participant, participantType);
  if (versionId) {
    entitySettings.version_id = versionId.version_id;
  }

  return {
    entity_name: entityName,
    entity_meta: entityMeta,
    entity_settings: entitySettings,
    meta: {
      mcp: (participant.meta as Record<string, unknown>)?.mcp || undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// buildModelParticipant — extracted from transformParticipant
// ---------------------------------------------------------------------------

/**
 * Builds a Model transformed participant (completely different wire shape).
 */
function buildModelParticipant(participant: Record<string, unknown>): TransformedParticipant {
  const modelMeta: Record<string, unknown> = {};
  if (participant.integration_uid) modelMeta.integration_uid = participant.integration_uid;
  if (participant.model_name) modelMeta.model_name = participant.model_name;

  return {
    entity_name: Models,
    entity_meta: modelMeta,
    entity_settings: {
      max_tokens: (participant.max_tokens as number) || DEFAULT_MAX_TOKENS,
      temperature: (participant.temperature as number) || DEFAULT_TEMPERATURE,
      reasoning_effort: (participant.reasoning_effort as string) || DEFAULT_REASONING_EFFORT,
    },
  };
}

// ---------------------------------------------------------------------------
// transformParticipant — orchestrator (complexity ≤ 4)
// ---------------------------------------------------------------------------

/**
 * Transforms a raw participant item from the candidate-browsing list into
 * the wire-shaped entity used by the chat conversation API.
 *
 * Ported from `addParticipants.helpers.js:21-81`.
 */
export function transformParticipant(
  participantType: ChatParticipantType,
  participant: Record<string, unknown>,
  _variables?: unknown[],
): TransformedParticipant {
  if (participantType === ChatParticipantType.Models) {
    return buildModelParticipant(participant);
  }
  return buildNonModelParticipant(participantType, participant, _variables);
}

// ---------------------------------------------------------------------------
// isParticipantsEqual — ported from old-app line 85-101
// ---------------------------------------------------------------------------

/**
 * Checks whether two participants represent the same entity.
 *
 * For Models: compares `entity_name`, `id`/`model_name`, and `integration_uid`.
 * For all other types: compares unique IDs (which include `project_id`).
 *
 * Ported from `addParticipants.helpers.js:85-101`.
 */
export function isParticipantsEqual(
  a: Record<string, unknown>,
  b: TransformedParticipant,
  type: ChatParticipantType,
  idFieldName: string,
): boolean {
  if (type === Models) {
    return (
      a.entity_name === b.entity_name &&
      String((a.entity_meta as Record<string, unknown>)?.[idFieldName] ?? a[idFieldName]) ===
        String(b.entity_meta[idFieldName as keyof typeof b.entity_meta]) &&
      // @ts-expect-error — 'a.entity_meta' is of type 'unknown'
      a.entity_meta.integration_uid === b.entity_meta.integration_uid
    );
  }

  // For all other types, use unique IDs to distinguish between public and custom entities
  // @ts-expect-error — missing properties from type 'Participant'
  const aId = chatParticipantUniqueId(a);
  // @ts-expect-error — missing properties from type 'Participant'
  const bId = chatParticipantUniqueId(b);
  return aId === bId;
}
