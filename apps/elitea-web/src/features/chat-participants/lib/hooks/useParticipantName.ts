// @ts-nocheck
import { useMemo } from 'react';

import { DEFAULT_PARTICIPANT_NAME } from '@/entities/participant';
import { getParticipantName } from '../helpers';

/**
 * Hook that resolves the display name for a chat participant.
 *
 * Ported from `useParticipantName.hooks.js`. The old app called
 * `useSystemSenderName()` (RTK Query-backed env-setting, no new-app port).
 * New-app behaviour: use `getParticipantName` (this cluster's own
 * snake_case-shaped port of `participants.helpers.js:23-44` — see
 * `lib/helpers.ts`'s module doc for why this is NOT `entities/participant`'s
 * `participantDisplayName`, which expects a different, camelCase shape and
 * would always miss for the raw wire-shaped objects this feature passes
 * around), falling back to `DEFAULT_PARTICIPANT_NAME` (`'Elitea'`).
 *
 * Disclosed gap: the old app allowed tenant-customised system sender names
 * via `useSystemSenderName`. This port always uses the hardcoded default.
 */
export function useParticipantName(participant: Record<string, unknown> | undefined): string {
  const name = useMemo(() => {
    if (!participant) return DEFAULT_PARTICIPANT_NAME;
    return getParticipantName(participant, DEFAULT_PARTICIPANT_NAME) || DEFAULT_PARTICIPANT_NAME;
  }, [participant]);

  return name;
}
