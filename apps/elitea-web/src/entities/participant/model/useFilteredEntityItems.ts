/**
 * Dedup/sort/search helper over candidate participant items — port of
 * `apps/elitea-ui/src/hooks/chat/useFilteredEntityItems.js`. Given a raw
 * candidate list (this slice's own `ParticipantEntityItem[]`, e.g. from
 * `useParticipants`) and the conversation's CURRENT participants, returns
 * only the candidates not already present, filtered by `search` and sorted
 * public-last-then-alphabetical.
 *
 * Only `'application'`/`'pipeline'`/`'toolkit'` are implemented, matching
 * the old hook's own `switch`, which has no `Users` case (falls through to
 * `default: return []`) — this is an "add agent/pipeline/toolkit" dropdown
 * helper, not a general one; `'user'` is accepted by the type for
 * `ParticipantCandidateType`-completeness but always yields `[]`, exactly
 * as the old hook's default branch does.
 */
import { chatParticipantUniqueId } from './selectors';
import type { Participant } from './types';
import type { ParticipantCandidateType, ParticipantEntityItem } from './participantCandidates';

function participantLikeFromEntityItem(item: ParticipantEntityItem, participantType: ParticipantCandidateType): Participant {
  const id = item.data['id'];
  const projectId = item.data['project_id'];
  return {
    id: '',
    entityName: participantType === 'pipeline' ? 'application' : participantType,
    entityMeta: {
      id: typeof id === 'string' || typeof id === 'number' ? String(id) : '',
      ...(typeof projectId === 'string' || typeof projectId === 'number' ? { projectId: String(projectId) } : {}),
    },
    ...(participantType === 'pipeline' ? { entitySettings: { agentType: 'pipeline' } } : {}),
  };
}

function existingEntityIds(participants: readonly Participant[], participantType: ParticipantCandidateType): ReadonlySet<string> {
  if (participantType === 'user') return new Set();
  const matches = participants.filter((p) => {
    const isPipelineParticipant = p.entityName === 'application' && p.entitySettings?.agentType === 'pipeline';
    if (participantType === 'pipeline') return isPipelineParticipant;
    if (participantType === 'application') return p.entityName === 'application' && !isPipelineParticipant;
    return p.entityName === participantType;
  });
  return new Set(matches.map(chatParticipantUniqueId).filter((id) => id !== ''));
}

function matchesLabel(item: ParticipantEntityItem, search: string): boolean {
  return item.label.toLowerCase().includes(search.toLowerCase());
}

/** `useFilteredEntityItems.js:101-113`'s extra toolkit-only search surface — also matches `data.type`/`data.settings.elitea_title`/`data.settings.configuration_title`. */
function matchesToolkitSearch(item: ParticipantEntityItem, search: string): boolean {
  const needle = search.toLowerCase();
  if (matchesLabel(item, needle)) return true;
  const type = item.data['type'];
  if (typeof type === 'string' && type.toLowerCase().includes(needle)) return true;
  const settings = item.data['settings'];
  if (typeof settings !== 'object' || settings === null) return false;
  const eliteaTitle = (settings as Readonly<Record<string, unknown>>)['elitea_title'];
  const configTitle = (settings as Readonly<Record<string, unknown>>)['configuration_title'];
  return (
    (typeof eliteaTitle === 'string' && eliteaTitle.toLowerCase().includes(needle)) ||
    (typeof configTitle === 'string' && configTitle.toLowerCase().includes(needle))
  );
}

function byLabel(a: ParticipantEntityItem, b: ParticipantEntityItem): number {
  if (a.isPublic !== b.isPublic) return a.isPublic ? 1 : -1;
  return a.label.localeCompare(b.label);
}

/**
 * Pure core — split from the hook wrapper below purely so a test can call
 * it without React. `useFilteredEntityItems.js:76-118`'s per-type
 * branches, ported (Applications/Pipelines share the same not-already-
 * added + search + public-last-sort recipe; Toolkits additionally searches
 * `type`/`settings.elitea_title`/`settings.configuration_title`).
 */
export function filterEntityItems(
  entityItems: readonly ParticipantEntityItem[],
  participants: readonly Participant[],
  participantType: ParticipantCandidateType,
  search: string,
): ParticipantEntityItem[] {
  if (participantType === 'user') return [];
  const existingIds = existingEntityIds(participants, participantType);
  const notAlreadyAdded = entityItems.filter(
    (item) => !existingIds.has(chatParticipantUniqueId(participantLikeFromEntityItem(item, participantType))),
  );
  const matcher = participantType === 'toolkit' ? matchesToolkitSearch : matchesLabel;
  return notAlreadyAdded.filter((item) => matcher(item, search)).sort(byLabel);
}

/** Hook wrapper — no internal state, kept as a hook purely to mirror the old app's call-site shape (`useFilteredEntityItems(entityItems, participants, participantType, search)`); every real caller can use `filterEntityItems` directly instead. */
export function useFilteredEntityItems(
  entityItems: readonly ParticipantEntityItem[],
  participants: readonly Participant[],
  participantType: ParticipantCandidateType,
  search: string,
): ParticipantEntityItem[] {
  return filterEntityItems(entityItems, participants, participantType, search);
}
