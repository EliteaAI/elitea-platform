/**
 * The chat-input "+" submenu's DATA layer — a narrow, purpose-built rebuild
 * of `apps/elitea-ui/src/hooks/useDropdownData.jsx` (the dependency
 * `[fsd]/features/chat/lib/hooks/chat-button/useApplicationSubmenu.hooks.js`
 * reads its four candidate lists from). `useApplicationSubmenu` itself —
 * checked/pending toggle state, `EntityIcon` construction, `onClick`
 * wiring against a live `participants` list — is UI/feature composition,
 * out of this cluster's scope (`processes/chat/model`, no JSX); a future
 * widget/feature that renders the actual submenu component composes this
 * hook's plain data with its own click handlers and icons, matching the
 * baseline's own split (`useDropdownData` returns items with NO onClick —
 * `useApplicationSubmenu` layers that on top).
 *
 * Per this Wave-2 run's own re-homing guidance: rebuilt directly over
 * `entities/participant`'s already-landed `useParticipants` aggregator
 * rather than importing `features/agents`/`features/toolkits` — the same
 * "reuse entities/participant's list hooks directly" instruction this
 * cluster's brief gives.
 *
 * **Forced architecture deviation from a literal `useDropdownData` port
 * (disclosed):** the brief's plan assumed reuse of `entities/participant`'s
 * PER-DOMAIN hooks (`usePrivateApplicationParticipants`/
 * `useToolkitParticipants`, etc). `no-deep-slice-import-cross-slice`
 * (`.dependency-cruiser.cjs`, R-L3) forbids importing anything from
 * `entities/participant` except through its `index.ts`, and that barrel is
 * already at 19/20 of its export budget (its own header) with zero room to
 * add 3+ more hook exports for this cluster alone. The barrel's only
 * cross-domain entry point is the AGGREGATOR, `useParticipants` — which
 * merges applications+pipelines+toolkits+mcps+users into ONE list per call
 * and does not expose the underlying toolkit hook's own `loadMore`/`hasMore`
 * (its own return type has no such field). Consequence, disclosed rather
 * than silently worked around:
 *
 *  1. Each of the four buckets below (agents/pipelines/toolkits/mcps) is
 *     its own `useParticipants({types: [...]})` call, filtered post-hoc to
 *     its own `participantType` — `types:['application']` fetches BOTH
 *     applications AND pipelines together (there is no way to request just
 *     one via this entry point), so the agents bucket and the pipelines
 *     bucket each independently re-fetch the other's data (matching their
 *     OWN search query) and discard it. Same for toolkits/mcps under
 *     `types:['toolkit']`. This is real, wasted network traffic relative to
 *     the baseline's 5 RTK Query hooks — but each bucket's DISPLAYED
 *     results stay correct (filtered by both type and its own search text).
 *  2. There is no "load more" here at all (`useParticipants`'s own return
 *     type has no `loadMore`) — every bucket shows whatever page its
 *     underlying source hooks already fetched (private applications capped
 *     at 20 rows server-side, public at 50, toolkits/mcps at 100 — see
 *     `entities/participant/model/{applicationParticipants,
 *     toolkitParticipants}.ts`'s own already-disclosed backend caps). A
 *     caller needing real pagination here is a real signal `entities/
 *     participant`'s barrel needs to grow (revisit its budget), not
 *     something this cluster can fix from `processes/`.
 *  3. MCP vs. non-MCp toolkit split: `entities/participant`'s merge collapses
 *     both into `participantType: 'toolkit'` (see `participantCandidates.ts`),
 *     so this file re-derives the split from `item.data`'s raw
 *     `type`/`meta.mcp` fields — a duplicate of `toolkitParticipants.ts`'s
 *     own `isMcpToolkitCandidate`, which is itself ALREADY a disclosed
 *     duplicate of `entities/toolkit`'s `isMcpToolkit` (`no-sideways-entities`
 *     forbids importing it either way — same precedented "small, disclosed
 *     duplication across a layer boundary" pattern used throughout this
 *     codebase).
 *
 * `agentQuery`/`pipelineQuery`/`toolkitQuery`/`mcpQuery` and the
 * "has the submenu ever been opened" gate (`skip`) are all caller-owned
 * state in the baseline (`useApplicationSubmenu`'s own `useState`s +
 * `hasBeenOpenedRef`) — this hook stays a pure "data for these search
 * strings" hook, taking them as parameters, matching `useDropdownData`'s
 * own shape exactly.
 */
import { useParticipants } from '@/entities/participant';
import type { ParticipantEntityItem } from '@/entities/participant';

function isMcpParticipantItem(item: ParticipantEntityItem): boolean {
  const type = item.data['type'];
  if (typeof type === 'string' && (type === 'mcp' || type.startsWith('mcp_'))) return true;
  const meta = item.data['meta'];
  return typeof meta === 'object' && meta !== null && (meta as Readonly<Record<string, unknown>>)['mcp'] === true;
}

export interface UseChatEntityBrowserParams {
  readonly projectId: string | undefined;
  /** `VITE_PUBLIC_PROJECT_ID` — see `entities/participant`'s `useParticipants` for the same pass-through convention. */
  readonly publicProjectId: string;
  readonly canListPublicAgents: boolean;
  readonly agentQuery?: string;
  readonly pipelineQuery?: string;
  readonly toolkitQuery?: string;
  readonly mcpQuery?: string;
  /** "Has this submenu ever been opened" gate — `false`/omitted skips all four fetches. */
  readonly skip?: boolean;
}

export interface ChatEntityBucket {
  readonly items: readonly ParticipantEntityItem[];
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly total: number;
}

export interface UseChatEntityBrowserResult {
  readonly agents: ChatEntityBucket;
  readonly pipelines: ChatEntityBucket;
  readonly toolkits: ChatEntityBucket;
  readonly mcps: ChatEntityBucket;
}

function toBucket(result: ReturnType<typeof useParticipants>, filter: (item: ParticipantEntityItem) => boolean): ChatEntityBucket {
  return {
    items: result.participants.filter(filter),
    isLoading: result.isLoading,
    isFetching: result.isFetching,
    total: result.total,
  };
}

/** `exactOptionalPropertyTypes`-safe: `useParticipants`'s `query` is optional but does not itself accept an explicit `undefined` — only spread the key in when a real (possibly empty) string was supplied. */
function queryProp(query: string | undefined): { readonly query: string } | Record<string, never> {
  return query === undefined ? {} : { query };
}

export function useChatEntityBrowser(params: UseChatEntityBrowserParams): UseChatEntityBrowserResult {
  const { projectId, publicProjectId, canListPublicAgents, agentQuery, pipelineQuery, toolkitQuery, mcpQuery, skip = false } = params;
  const enabled = !skip;
  const common = { projectId, publicProjectId, canListPublicAgents, enabled };

  const agentsResult = useParticipants({ ...common, ...queryProp(agentQuery), types: ['application'] });
  const pipelinesResult = useParticipants({ ...common, ...queryProp(pipelineQuery), types: ['application'] });
  const toolkitsResult = useParticipants({ ...common, ...queryProp(toolkitQuery), types: ['toolkit'] });
  const mcpsResult = useParticipants({ ...common, ...queryProp(mcpQuery), types: ['toolkit'] });

  return {
    agents: toBucket(agentsResult, (item) => item.participantType === 'application'),
    pipelines: toBucket(pipelinesResult, (item) => item.participantType === 'pipeline'),
    toolkits: toBucket(toolkitsResult, (item) => !isMcpParticipantItem(item)),
    mcps: toBucket(mcpsResult, isMcpParticipantItem),
  };
}
