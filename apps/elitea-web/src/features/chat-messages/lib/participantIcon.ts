/**
 * Icon type resolution for chat participants.
 *
 * Not a direct port from a single old-app file — this is the chat-participant
 * icon resolution logic needed by `ApplicationAnswer.jsx` and `UserMessage.jsx`
 * in the old app.
 *
 * For each `ChatParticipantType` value, `resolveParticipantEntityType` returns
 * the entity type string that the new-app's icon lookup can resolve.
 *
 * Port logic from:
 * - `apps/elitea-ui/src/[fsd]/features/chat/participants/lib/hooks/
 *   useParticipantEntityIcon.hooks.js` (48 lines) — the icon resolution hook
 * - `apps/elitea-ui/src/[fsd]/features/chat/ui/chat-box/
 *   ApplicationAnswer.jsx` (line ~499) — the consumer site
 */
import { ChatParticipantType } from '@/shared/lib/chat';

/**
 * Resolves a participant to the entity type string used for icon lookup.
 *
 * Mirrors the old-app `useParticipantEntityIcon` logic:
 * - Dummy / unknown → `'dummy'`
 * - Applications, Models, Users, Pipelines, Skills → their `ChatParticipantType` value
 * - Toolkits → resolved via the Toolkit icon service (returns `'toolkit'`)
 *
 * @param participant — the participant object (may be nullish).
 * @returns the entity type string for icon resolution.
 */
export function resolveParticipantEntityType(participant: {
  readonly entity_name?: string;
  readonly entity_settings?: { readonly toolkit_type?: string };
  readonly type?: string;
  readonly participantType?: string;
  readonly meta?: { readonly mcp?: boolean };
} | null | undefined): string {
  if (!participant) return ChatParticipantType.Dummy;

  const entityType = participant.entity_name;

  // Nullish or missing entity_name → Dummy icon.
  if (!entityType) {
    return ChatParticipantType.Dummy;
  }

  // Toolkits resolve via a dedicated icon service; the entity type
  // string the icon lookup needs is just `'toolkit'`.
  const isToolkit =
    entityType === ChatParticipantType.Toolkits ||
    participant.participantType === ChatParticipantType.Toolkits;

  if (isToolkit) {
    return ChatParticipantType.Toolkits;
  }

  // All other types use their ChatParticipantType value directly.
  return entityType;
}

/**
 * Hook variant of `resolveParticipantEntityType`.
 * Mirrors the old-app `useParticipantEntityIcon` but returns just the
 * entity type string (the icon resolver caller handles component rendering).
 *
 * NOTE: Unlike the old-app hook, this does NOT return an `{ component, ...icon_meta }`
 * object — it just resolves the entity type. Full icon resolution (with
 * theme, toolkitSchemas, etc.) belongs to a separate icon-resolver module.
 */
export function useParticipantEntityType(participant: {
  readonly entity_name?: string;
  readonly entity_settings?: { readonly toolkit_type?: string };
  readonly type?: string;
  readonly participantType?: string;
  readonly meta?: { readonly mcp?: boolean };
}): string {
  return resolveParticipantEntityType(participant);
}
