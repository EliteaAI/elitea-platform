/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 * 20/20 used — the 1 remaining slot (unit C1 landing report) spent on
 * `participantSources` below (Wave-2 unit C6's `chat-recommendations`
 * consumer), a curated OBJECT BUNDLE of the 5 candidate-source
 * hooks/helpers — 1 named export regardless of property count, same
 * pattern `entities/conversation/index.ts` uses for `conversationApi`/
 * `chatHelpers`/etc.
 */
import { buildParticipantCandidates } from './model/participantCandidates';
import {
  usePrivateApplicationParticipants,
  usePublicApplicationParticipants,
} from './model/applicationParticipants';
import { useToolkitParticipants } from './model/toolkitParticipants';
import { useUserParticipants } from './model/userParticipants';

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

/** Candidate-source hooks/helpers for building a browsable participant list (Wave-2 unit C6). */
export const participantSources = {
  buildParticipantCandidates,
  usePrivateApplicationParticipants,
  usePublicApplicationParticipants,
  useToolkitParticipants,
  useUserParticipants,
};
