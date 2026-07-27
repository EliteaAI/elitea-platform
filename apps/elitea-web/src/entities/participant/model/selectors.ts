import type { Participant, ParticipantType } from './types';

/** apps/elitea-ui/src/common/constants.js:88 `DEFAULT_PARTICIPANT_NAME`. */
export const DEFAULT_PARTICIPANT_NAME = 'Elitea';

/**
 * participants.helpers.js:5-8 — an `application` participant whose
 * `entitySettings.agentType` is `"pipeline"` is keyed as a pipeline
 * (Applications/Pipelines share an underlying entity type, see
 * entities/application's module doc).
 */
function uniqueIdEntityKey(participant: Participant): string {
  const isApplicationActingAsPipeline =
    participant.entityName === 'application' && participant.entitySettings?.agentType === 'pipeline';
  return isApplicationActingAsPipeline ? 'pipeline' : participant.entityName;
}

/** participants.helpers.js:10-14 — Models compose `modelName-integrationUid`; everything else uses `entityMeta.id`. */
function uniqueIdBody(participant: Participant): string {
  if (participant.entityName === 'llm') {
    return `${participant.entityMeta?.modelName ?? ''}-${participant.entityMeta?.integrationUid ?? ''}`;
  }
  return participant.entityMeta?.id ?? '';
}

/**
 * apps/elitea-ui/src/[fsd]/features/chat/participants/lib/helpers/
 * participants.helpers.js:3-21 `getChatParticipantUniqueId`, ported
 * verbatim (split into the two pure helpers above to stay under the §3.5
 * cyclomatic-complexity budget); `entityMeta.projectId` is always appended,
 * defaulting to `""`.
 */
export function chatParticipantUniqueId(participant: Participant): string {
  return `${uniqueIdEntityKey(participant)}_${uniqueIdBody(participant)}_${participant.entityMeta?.projectId ?? ''}`;
}

/** participants.helpers.js:24,32,37,40 — the shared entityMeta.name/meta.name fallback chain. */
function nameFromEntityMetaOrMeta(participant: Participant): string {
  return participant.entityMeta?.name ?? participant.meta?.name ?? '';
}

function nameFromModel(participant: Participant): string {
  return participant.entityMeta?.modelName ?? '';
}

function nameFromUserMeta(participant: Participant): string {
  return participant.meta?.userName ?? '';
}

/**
 * participants.helpers.js:23-44 `getParticipantName`'s per-`entityName`
 * dispatch, as a lookup table rather than a `switch` — behaviourally
 * identical, but keeps `participantDisplayName` itself under the §3.5
 * cyclomatic-complexity budget (a `switch` with this many cases plus
 * per-case fallback chains does not fit under 12).
 */
const NAME_RESOLVERS: Readonly<Record<ParticipantType, (participant: Participant, systemSenderName: string) => string>> = {
  application: nameFromEntityMetaOrMeta,
  pipeline: nameFromEntityMetaOrMeta,
  toolkit: nameFromEntityMetaOrMeta,
  skill: nameFromEntityMetaOrMeta,
  llm: nameFromModel,
  user: nameFromUserMeta,
  dummy: (_participant, systemSenderName) => systemSenderName,
};

/**
 * apps/elitea-ui/src/[fsd]/features/chat/participants/lib/helpers/
 * participants.helpers.js:23-44 `getParticipantName`, ported verbatim in
 * effect via the `NAME_RESOLVERS` table above. A lookup miss is
 * unreachable given `ParticipantType`'s closed union, but the `''`
 * fallback is kept for resilience against malformed/mistyped input at a
 * real socket/API boundary — mirroring the old app's own defensive
 * `default: return ''`.
 */
export function participantDisplayName(
  participant: Participant,
  systemSenderName: string = DEFAULT_PARTICIPANT_NAME,
): string {
  const resolve = NAME_RESOLVERS[participant.entityName];
  return resolve !== undefined ? resolve(participant, systemSenderName) : '';
}

/**
 * apps/elitea-ui/src/[fsd]/features/chat/participants/lib/helpers/
 * participants.helpers.js:55-62 `isSkippedContainerParticipant`, ported
 * verbatim: a "container" agent (self-orchestrating, not itself callable as
 * a tool) is any non-pipeline `application` participant with
 * `meta.isContainer === true`. Pipelines are the sanctioned
 * deep-composition primitive and are never flagged, hence the explicit
 * `entitySettings.agentType`/top-level `agentType` pipeline check.
 */
export function isSkippedContainerParticipant(participant: Participant): boolean {
  if (participant.meta?.isContainer !== true) return false;
  if (participant.entityName !== 'application') return false;
  const isPipeline = participant.entitySettings?.agentType === 'pipeline' || participant.agentType === 'pipeline';
  return !isPipeline;
}

/**
 * apps/elitea-ui/src/[fsd]/features/chat/participants/lib/helpers/
 * participants.helpers.js:64-77 `isParticipantStillActive`, ported verbatim.
 */
export function isParticipantStillActive(participant: Participant): boolean {
  switch (participant.entityName) {
    case 'application':
    case 'skill':
      return Boolean(participant.meta?.name);
    case 'llm':
      return Boolean(participant.entityMeta?.modelName);
    case 'dummy':
      return true;
    case 'pipeline':
    case 'toolkit':
    case 'user':
      return false;
  }
}
