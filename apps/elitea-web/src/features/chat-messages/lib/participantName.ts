/**
 * Ported from:
 * - `apps/elitea-ui/src/[fsd]/features/chat/participants/lib/hooks/
 *   useParticipantName.hooks.js` (14 lines) — the `useParticipantName` hook
 * - `apps/elitea-ui/src/[fsd]/features/chat/participants/lib/helpers/
 *   participants.helpers.js:23-43` — the `getParticipantName` pure function
 *
 * `getParticipantName` resolves a `ChatParticipantType` discriminator
 * (Applications, Models, Users, Dummy, Pipelines, Toolkits, Skills) to a
 * human-readable name. `useParticipantName` wraps it with
 * `useSystemSenderName()` and falls back to `DEFAULT_PARTICIPANT_NAME`.
 *
 * The pure function is exported for unit-testability without React.
 */
import { useMemo } from 'react';

import { DEFAULT_PARTICIPANT_NAME, useSystemSenderName } from '@/shared/lib/hooks/useEnvironmentSettingByKey';

import { ChatParticipantType } from '@/shared/lib/chat';

/**
 * A minimal participant shape accepted by `getParticipantName`.
 * Mirrors the old-app destructuring (`participant?.entity_name`,
 * `participant?.entity_meta?.name`, etc.) without dragging in the
 * full `Participant` type.
 */
export interface ParticipantNameInput {
  readonly entity_name?: string;
  readonly entity_meta?: {
    readonly name?: string;
    readonly model_name?: string;
  };
  readonly meta?: {
    readonly name?: string;
    readonly user_name?: string;
  };
}

/**
 * `getParticipantName` — pure function that resolves a participant to a
 * human-readable name.
 *
 * Ported verbatim from `participants.helpers.js:23-43` (lines noted).
 *
 * @param participant — the participant object (may be nullish).
 * @param systemSenderName — fallback for Dummy participants.
 * @returns the resolved name, or empty string `''` when not determinable.
 */
export function getParticipantName(
  participant: ParticipantNameInput | undefined | null,
  systemSenderName: string,
): string {
  // eslint-disable-next-line typescript/switch-exhaustiveness-check — participant?.entity_name may be undefined
  switch (participant?.entity_name) {
    case ChatParticipantType.Applications:
      return participant.entity_meta?.name || participant.meta?.name || '';
    case ChatParticipantType.Models:
      return participant.entity_meta?.model_name || '';
    case ChatParticipantType.Users:
      return participant.meta?.user_name || '';
    case ChatParticipantType.Pipelines:
      return participant.entity_meta?.name || participant.meta?.name || '';
    case ChatParticipantType.Toolkits:
      return participant.entity_meta?.name || participant.meta?.name || '';
    case ChatParticipantType.Skills:
      return participant.entity_meta?.name || participant.meta?.name || '';
    case ChatParticipantType.Dummy:
      return systemSenderName;
    default:
      return '';
  }
}

/**
 * `useParticipantName` — hook that wraps `getParticipantName` with
 * `useSystemSenderName()` and falls back to `DEFAULT_PARTICIPANT_NAME`.
 *
 * Ported from `useParticipantName.hooks.js`.
 *
 * @param participant — the participant object (may be nullish).
 * @returns the resolved name (never empty — defaults to `DEFAULT_PARTICIPANT_NAME`).
 */
export function useParticipantName(
  participant: ParticipantNameInput | undefined | null,
): string {
  const systemSenderName = useSystemSenderName();
  const participantName = useMemo(
    () => getParticipantName(participant, systemSenderName) || DEFAULT_PARTICIPANT_NAME,
    [participant, systemSenderName],
  );
  return participantName;
}
