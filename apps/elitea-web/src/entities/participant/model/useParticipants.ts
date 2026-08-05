/**
 * Chat candidate-participant aggregator — the composition half of
 * `apps/elitea-ui/src/hooks/chat/useParticipants.js`'s 472-line hook,
 * rebuilt directly over this slice's own `applicationParticipants.ts`/
 * `toolkitParticipants.ts`/`userParticipants.ts` sources (per the mission
 * preamble: rebuild the REAL underlying data sources, do not import
 * `features/agents`/`features/toolkits`) and `participantCandidates.ts`'s
 * pure merge/sort helper. Split across several small helpers (this file's
 * own `isApplicationsWanted`/`isToolkitsWanted`/`isUsersWanted`/
 * `isPrivateGateOpen`/`isPublicGateOpen`/`combineFetchStates`/
 * `combineTotal`) purely to keep `useParticipants` itself under the §3.5
 * cyclomatic-complexity budget (12) — the old 472-line file's size came
 * from exactly this much inlined boolean-gating logic.
 *
 * **Deliberate parameter surface difference from the old hook**, forced by
 * the layer rule (`no-upward-from-entities`): the old hook derives
 * `projectId` (`useSelectedProjectId`), `userId`/`personal_project_id`
 * (Redux `state.user`), and `canListPublicAgents`
 * (`useCanListThisPublicEntity`) internally. `entities/` may import only
 * `shared/`, so every one of those becomes an explicit parameter here — the
 * calling feature/page layer (a future C5 chat-participants unit) resolves
 * them the same way every other Wave-2 unit already does (its own
 * `useSelectedProjectId.ts`/permission-hook duplicate) and passes them in.
 *
 * **Real, disclosed behavioural quirk, reproduced not fixed (N4):** in the
 * old hook, the fetch-skip gates are INCONSISTENT across sources —
 * applications/pipelines use `!types.length || types.includes(...)`
 * (lenient: an empty `types` array fetches everything), but toolkits/MCPs
 * and users use a bare `!types.includes(...)` with no `!types.length ||`
 * fallback (strict: an empty `types` array skips their fetch entirely,
 * DESPITE `realDataList`'s own toolkit-composition branch using the lenient
 * gate — moot, since the toolkit fetch never ran). Net effect: calling this
 * hook with `types: []` (the naive "show every type" reading) returns
 * applications AND pipelines but NEVER toolkits/MCPs/users. Reproduced
 * exactly below rather than "fixed" to the more intuitive lenient gate
 * everywhere, since a real caller may already depend on this asymmetry.
 */
import type { ParticipantBrowseType, ParticipantEntityItem } from './participantCandidates';
import { buildParticipantCandidates } from './participantCandidates';
import { usePrivateApplicationParticipants, usePublicApplicationParticipants } from './applicationParticipants';
import { useToolkitParticipants } from './toolkitParticipants';
import { useUserParticipants } from './userParticipants';

export interface UseParticipantsParams {
  readonly projectId: string | undefined;
  /** `VITE_PUBLIC_PROJECT_ID` — resolved by the caller via `shared/config`'s `getConfig()` (see `entities/project`'s `isPublicProject` for the established param-passing convention this mirrors). */
  readonly publicProjectId: string;
  /** The signed-in user's own private/personal project id — users are never listed while browsing it (`hooks/useUserList.js:24`'s `projectId == privateProjectId` skip). */
  readonly privateProjectId?: string | undefined;
  /** Excluded from the user candidate list (`useParticipants.js:317`). */
  readonly currentUserId?: string | undefined;
  /** `useCanListThisPublicEntity('agents')` at the call site — see file header. */
  readonly canListPublicAgents: boolean;
  readonly query?: string;
  /** Empty = "applications + pipelines only" — see the file header's disclosed quirk, NOT "every type". */
  readonly types?: readonly ParticipantBrowseType[];
  readonly projectFilter?: 'all' | 'public' | 'teamProject';
  readonly enabled?: boolean;
}

export interface UseParticipantsResult {
  readonly participants: readonly ParticipantEntityItem[];
  readonly total: number;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

function isApplicationsWanted(enabled: boolean, types: readonly ParticipantBrowseType[]): boolean {
  return enabled && (types.length === 0 || types.includes('application'));
}

function isToolkitsWanted(enabled: boolean, types: readonly ParticipantBrowseType[]): boolean {
  return enabled && types.includes('toolkit');
}

function isUsersWanted(enabled: boolean, types: readonly ParticipantBrowseType[]): boolean {
  return enabled && types.includes('user');
}

/** `useApplicationParticipants.js:51`'s `skip: ... || (projectFilter === 'public' && !canListPublicAgents)`, negated to an "is this gate open" predicate. */
function isPrivateGateOpen(projectFilter: string, canListPublicAgents: boolean): boolean {
  return !(projectFilter === 'public' && !canListPublicAgents);
}

/** `usePublicApplicationParticipants.js:36`'s `skip: ... || projectFilter === 'teamProject' || canListPublicAgents`, negated. */
function isPublicGateOpen(projectFilter: string, canListPublicAgents: boolean): boolean {
  return !(projectFilter === 'teamProject' || canListPublicAgents);
}

interface FetchState {
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

function combineFetchStates(states: readonly FetchState[]): FetchState {
  return {
    isLoading: states.some((s) => s.isLoading),
    isFetching: states.some((s) => s.isFetching),
    isError: states.some((s) => s.isError),
    error: states.find((s) => s.error !== undefined)?.error,
  };
}

interface CombineTotalParams {
  readonly applicationsWanted: boolean;
  readonly toolkitsWanted: boolean;
  readonly usersWanted: boolean;
  readonly applicationsTotal: number;
  readonly toolkitsTotal: number;
  readonly usersTotal: number;
}

function combineTotal(params: CombineTotalParams): number {
  const applications = params.applicationsWanted ? params.applicationsTotal : 0;
  const toolkits = params.toolkitsWanted ? params.toolkitsTotal : 0;
  const users = params.usersWanted ? params.usersTotal : 0;
  return applications + toolkits + users;
}

export function useParticipants(params: UseParticipantsParams): UseParticipantsResult {
  const {
    projectId,
    publicProjectId,
    privateProjectId,
    currentUserId,
    canListPublicAgents,
    query,
    types = [],
    projectFilter = 'all',
    enabled = true,
  } = params;
  const safeQuery = query ?? '';

  const applicationsWanted = isApplicationsWanted(enabled, types);
  const toolkitsWanted = isToolkitsWanted(enabled, types);
  const usersWanted = isUsersWanted(enabled, types);
  const privateGateOpen = isPrivateGateOpen(projectFilter, canListPublicAgents);
  const publicGateOpen = isPublicGateOpen(projectFilter, canListPublicAgents);

  const privateApplications = usePrivateApplicationParticipants({
    projectId,
    agentsType: 'classic',
    query: safeQuery,
    enabled: applicationsWanted && privateGateOpen,
  });
  const publicApplications = usePublicApplicationParticipants({
    agentsType: 'classic',
    query: safeQuery,
    enabled: applicationsWanted && publicGateOpen,
  });
  const privatePipelines = usePrivateApplicationParticipants({
    projectId,
    agentsType: 'pipeline',
    query: safeQuery,
    enabled: applicationsWanted && privateGateOpen,
  });
  const publicPipelines = usePublicApplicationParticipants({
    agentsType: 'pipeline',
    query: safeQuery,
    enabled: applicationsWanted && publicGateOpen,
  });
  const privateToolkits = useToolkitParticipants({ projectId, query: safeQuery, enabled: toolkitsWanted });
  const publicToolkits = useToolkitParticipants({
    projectId: publicProjectId,
    query: safeQuery,
    enabled: toolkitsWanted && projectId !== publicProjectId,
  });
  const users = useUserParticipants({
    projectId,
    query: safeQuery,
    enabled: usersWanted && projectId !== privateProjectId,
  });

  const { isLoading, isFetching, isError, error } = combineFetchStates([
    privateApplications,
    publicApplications,
    privatePipelines,
    publicPipelines,
    privateToolkits,
    publicToolkits,
    users,
  ]);

  // Not `useMemo`-wrapped: the merge/sort itself is a cheap pass over
  // already-small, already-fetched in-memory arrays, and the real
  // dependency set here (9 source arrays + 2 scalars) is well past the
  // §3.5 8-entry hook-deps budget — recomputing every render is the
  // simpler, still-cheap alternative to an artificially bundled deps array.
  const participants = buildParticipantCandidates({
    privateApplications: privateApplications.rows,
    publicApplications: publicApplications.rows,
    privatePipelines: privatePipelines.rows,
    publicPipelines: publicPipelines.rows,
    privateToolkits: privateToolkits.toolkits,
    publicToolkits: publicToolkits.toolkits,
    privateMcps: privateToolkits.mcps,
    publicMcps: publicToolkits.mcps,
    users: users.rows,
    currentUserId,
    types,
  });

  const total = combineTotal({
    applicationsWanted,
    toolkitsWanted,
    usersWanted,
    applicationsTotal: privateApplications.total + publicApplications.total + privatePipelines.total + publicPipelines.total,
    toolkitsTotal: privateToolkits.total + publicToolkits.total,
    usersTotal: users.total,
  });

  return { participants, total, isLoading, isFetching, isError, error };
}
