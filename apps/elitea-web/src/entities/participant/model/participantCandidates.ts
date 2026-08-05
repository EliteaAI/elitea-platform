/**
 * Pure assembly helpers for `useParticipants.ts` — the merge/tag/sort half
 * of `apps/elitea-ui/src/hooks/chat/useParticipants.js`'s 472-line
 * aggregator (its `realDataList`/`realDataTotal` `useMemo` blocks), split
 * out into standalone, hook-free functions so they stay independently
 * testable and keep `useParticipants.ts` itself under the §3.5 file-length/
 * complexity budgets.
 *
 * Takes toolkit rows as `toolkitParticipants.ts`'s LOCAL `ToolkitCandidate`
 * type (not `entities/toolkit`'s `Toolkit`) — `no-sideways-entities`
 * forbids this slice importing another entity slice at all; see
 * `toolkitParticipants.ts`'s own header for the full citation.
 */
import type { Application, PublicApplicationSummary, UserRecord } from '@/shared/api/generated/model';
import { toolkitCandidateDisplayName } from './toolkitParticipants';
import type { ToolkitCandidate } from './toolkitParticipants';

/** The subset of `ParticipantType` this browsing list ever produces — pipelines are `application`s with `entitySettings.agentType === 'pipeline'`, never a distinct wire `entity_name`. */
export type ParticipantCandidateType = 'application' | 'pipeline' | 'toolkit' | 'user';

/** The subset of `ParticipantCandidateType` a caller can filter the browse list BY — matches `ChatParticipantType.{Applications,Toolkits,Users}`; `'pipeline'` items are gated by the `'application'` bucket, same as the old app's `types.includes(ChatParticipantType.Applications)` covering both. */
export type ParticipantBrowseType = 'application' | 'toolkit' | 'user';

export interface ParticipantEntityItem {
  readonly label: string;
  readonly participantType: ParticipantCandidateType;
  readonly isPublic: boolean;
  /** The original wire row (`Application`/`PublicApplicationSummary`/`Toolkit`/`UserRecord`), untyped here so this module stays generic over all four sources. */
  readonly data: Readonly<Record<string, unknown>>;
}

function applicationDisplayName(row: { readonly name: string }): string {
  return row.name.trim() !== '' ? row.name : 'Untitled';
}

function toApplicationItem(row: Application, isPublic: boolean): ParticipantEntityItem {
  return { label: applicationDisplayName(row), participantType: 'application', isPublic, data: row };
}

function toPublicApplicationItem(row: PublicApplicationSummary): ParticipantEntityItem {
  return { label: applicationDisplayName(row), participantType: 'application', isPublic: true, data: row };
}

function toPipelineItem(row: Application, isPublic: boolean): ParticipantEntityItem {
  return { label: applicationDisplayName(row), participantType: 'pipeline', isPublic, data: row };
}

function toPublicPipelineItem(row: PublicApplicationSummary): ParticipantEntityItem {
  return { label: applicationDisplayName(row), participantType: 'pipeline', isPublic: true, data: row };
}

function toToolkitItem(toolkit: ToolkitCandidate, isPublic: boolean): ParticipantEntityItem {
  return {
    label: toolkitCandidateDisplayName(toolkit),
    participantType: 'toolkit',
    isPublic,
    data: toolkit as unknown as Readonly<Record<string, unknown>>,
  };
}

function toUserItem(user: UserRecord): ParticipantEntityItem {
  return { label: user.name !== '' ? user.name : user.email, participantType: 'user', isPublic: false, data: user };
}

export interface BuildParticipantCandidatesInput {
  readonly privateApplications: readonly Application[];
  readonly publicApplications: readonly PublicApplicationSummary[];
  readonly privatePipelines: readonly Application[];
  readonly publicPipelines: readonly PublicApplicationSummary[];
  readonly privateToolkits: readonly ToolkitCandidate[];
  readonly publicToolkits: readonly ToolkitCandidate[];
  readonly privateMcps: readonly ToolkitCandidate[];
  readonly publicMcps: readonly ToolkitCandidate[];
  /** Already query-filtered by `useUserParticipants` — `currentUserId` is excluded here (mirrors `useParticipants.js:317`'s `.filter(user => user.id != userId)`). */
  readonly users: readonly UserRecord[];
  readonly currentUserId?: string | undefined;
  /** Empty = every type. */
  readonly types: readonly ParticipantBrowseType[];
}

function browseTypeOf(item: ParticipantEntityItem): ParticipantBrowseType {
  return item.participantType === 'pipeline' ? 'application' : item.participantType;
}

function isTypeIncluded(item: ParticipantEntityItem, types: readonly ParticipantBrowseType[]): boolean {
  return types.length === 0 || types.includes(browseTypeOf(item));
}

/**
 * Merges every already-fetched, already-query-filtered source array into
 * one alphabetically-sorted candidate list, mirroring `useParticipants.js:
 * 277-388`'s `realDataList` — minus the search filtering (each source hook
 * in this slice already applies `query` itself, either server-side or
 * client-side per its own doc comment) and minus the `!selectedTagIds
 * ?.length` gate on users (tag filtering is a features-layer concern with
 * no equivalent generated param on any of these three endpoints — same
 * disclosed-gap treatment as the per-source hooks' own doc comments).
 */
export function buildParticipantCandidates(input: BuildParticipantCandidatesInput): ParticipantEntityItem[] {
  const users = input.currentUserId === undefined ? input.users : input.users.filter((u) => u.id !== input.currentUserId);
  const items: ParticipantEntityItem[] = [
    ...input.privateApplications.map((row) => toApplicationItem(row, false)),
    ...input.publicApplications.map(toPublicApplicationItem),
    ...input.privatePipelines.map((row) => toPipelineItem(row, false)),
    ...input.publicPipelines.map(toPublicPipelineItem),
    ...input.privateToolkits.map((row) => toToolkitItem(row, false)),
    ...input.publicToolkits.map((row) => toToolkitItem(row, true)),
    ...input.privateMcps.map((row) => toToolkitItem(row, false)),
    ...input.publicMcps.map((row) => toToolkitItem(row, true)),
    ...users.map(toUserItem),
  ];
  return items.filter((item) => isTypeIncluded(item, input.types)).sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
}
