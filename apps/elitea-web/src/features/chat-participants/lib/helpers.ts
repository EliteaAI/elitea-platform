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
// transformParticipant — ported from old-app line 21-81
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_REASONING_EFFORT = 'medium';

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
  // Models have a completely different wire shape (no entity_meta with id)
  if (participantType !== ChatParticipantType.Models) {
    return {
      entity_name: participant.agent_type === 'pipeline' ? ChatParticipantType.Applications : participantType,
      entity_meta: {
        // @ts-expect-error — spread of `participant.id && { id }` on non-object
        ...(participant.id && { id: participant.id }),
        // @ts-expect-error — spread of `participant.name && { name }` on non-object
        ...(participant.name && { name: participant.name }),
        // @ts-expect-error — spread of `participant.project_id && { project_id }` on non-object
        ...(participant.project_id && { project_id: participant.project_id }),
      },
      entity_settings: {
        variables:
          (_variables as unknown[]) ||
          (participant.entity_settings as Record<string, unknown>)?.variables ||
          (participantType === ChatParticipantType.Applications
            ? (participant.version_details as Record<string, unknown>)?.variables
            : undefined) ||
          [],
        icon_meta:
          participantType !== ChatParticipantType.Toolkits
            ? {
                // @ts-expect-error — spread of potentially non-object
                ...((participant.entity_settings as Record<string, any>)?.icon_meta ||
                (participant.meta as Record<string, any>)?.icon_meta ||
                (participant.icon_meta as Record<string, any>)),
              }
            : {},
        toolkit_type: participant.type as string | undefined,
        agent_type: participant.agent_type as string | undefined,
        // @ts-expect-error — spread of `(entity_settings)?.version_id && { version_id }` on non-object
        ...((participant.entity_settings as Record<string, any>)?.version_id && {
          version_id: (participant.entity_settings as Record<string, any>)?.version_id,
        }),
        mcp_server_url:
          (participant.settings as Record<string, unknown>)?.url ||
          (participant.entity_settings as Record<string, unknown>)?.mcp_server_url ||
          undefined,
        ...(participantType === ChatParticipantType.Applications &&
          (participant.version_details as Record<string, unknown>)?.id &&
          !(participant.entity_settings as Record<string, unknown>)?.version_id && {
            version_id: (participant.version_details as Record<string, unknown>)?.id,
          }),
      },
      meta: {
        mcp: (participant.meta as Record<string, unknown>)?.mcp || undefined,
      },
    };
  }

  // Models wire shape
  const modelMeta: Record<string, any> = {
    ...(participant.integration_uid && { integration_uid: participant.integration_uid }),
    ...(participant.model_name && { model_name: participant.model_name }),
  };
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
      String((a.entity_meta as Record<string, unknown>)?.[idFieldName] ?? (a as Record<string, unknown>)?.[idFieldName]) ===
        String(b.entity_meta[idFieldName as keyof typeof b.entity_meta]) &&
      // @ts-expect-error — 'a.entity_meta' is of type 'unknown'
      a.entity_meta.integration_uid === b.entity_meta.integration_uid
    );
  }

  // For all other types, use unique IDs to distinguish between public and custom entities
  // @ts-expect-error — missing properties from type 'Participant'
  const aId = chatParticipantUniqueId(a as Record<string, unknown>);
  // @ts-expect-error — missing properties from type 'Participant'
  const bId = chatParticipantUniqueId(b);
  return aId === bId;
}
