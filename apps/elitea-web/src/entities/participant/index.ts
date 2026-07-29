/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 * 19/20 used — 1 slot of deliberate headroom (unit C1 landing report).
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

// ── Unit C1 additions: participant CRUD + multi-domain chat aggregation ──
export type { ParticipantEntityItem } from './model/participantCandidates';
export type { UseParticipantsResult } from './model/useParticipants';
export { useParticipants } from './model/useParticipants';
export { useFilteredEntityItems } from './model/useFilteredEntityItems';
export { useIsActiveParticipantBeingEdited } from './model/useIsActiveParticipantBeingEdited';
export {
  useAddParticipantMutation,
  useDeleteParticipantMutation,
  useUpdateParticipantSettingsMutation,
  useUpdateParticipantLlmSettingsMutation,
} from './api/participantApi';
