/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type {
  Participant,
  ParticipantEntityMeta,
  ParticipantMeta,
  ParticipantSettings,
  ParticipantType,
} from './model/types';
export {
  DEFAULT_PARTICIPANT_NAME,
  chatParticipantUniqueId,
  isParticipantStillActive,
  isSkippedContainerParticipant,
  participantDisplayName,
} from './model/selectors';
