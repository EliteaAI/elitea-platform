// @ts-nocheck
import { useMemo } from 'react';

import { participantDisplayName } from '@/entities/participant';
import { DEFAULT_PARTICIPANT_NAME } from '@/entities/participant';

/**
 * Hook that resolves the display name for a chat participant.
 *
 * Ported from `useParticipantName.hooks.js`. The old app called
 * `useSystemSenderName()` (RTK Query-backed env-setting, no new-app port).
 * New-app behaviour: use `participantDisplayName` from entities/participant,
 * falling back to `DEFAULT_PARTICIPANT_NAME` (`'Elitea'`).
 *
 * Disclosed gap: the old app allowed tenant-customised system sender names
 * via `useSystemSenderName`. This port always uses the hardcoded default.
 */
export function useParticipantName(participant: Record<string, unknown> | undefined): string {
  const name = useMemo(() => {
    if (!participant) return DEFAULT_PARTICIPANT_NAME;
    return participantDisplayName(participant) || DEFAULT_PARTICIPANT_NAME;
  }, [participant]);

  return name;
}
