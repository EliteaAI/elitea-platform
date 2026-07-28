import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import type { Toolkit } from '@/entities/toolkit';
import { getGetApplicationQueryKey, useGetApplication, useListApplications } from '@/shared/api/generated/applications/applications';
import type { Application, ApplicationDetail } from '@/shared/api/generated/model';
import { t } from '@/shared/i18n';
import { SearchParams } from '@/shared/lib/params';

import { useAgentPipelineAssociation } from '../api/useAgentPipelineAssociation';
import type { AssociationCandidate } from '../api/useAgentPipelineAssociation';
import { useIsMcpVisible } from '../api/useIsMcpVisible';
import { useSelectedProjectId } from '../api/useSelectedProjectId';
import { useFilterAddedItems } from '../lib/useFilterAddedItems';
import type { AgentToolAssociation } from '../lib/types';

import { EntityAddSection, InstanceAddSection, useEntityAssociationItems, useToolkitInstanceRows } from './ToolMenuSections';

/**
 * Ported from
 * `apps/elitea-ui/src/pages/Applications/Components/Tools/ToolMenu.jsx`
 * (Wave-2 unit A1e). Renders the "Toolkit / MCP / Agent / Pipeline" add
 * buttons above an agent or pipeline's tool list, each opening a searchable
 * dropdown. The actual button+dropdown compositions live in
 * `ToolMenuSections.tsx` (split out to stay under the §3.5 400-line-per-file
 * budget) — this file owns only the entity-detail resolution (`useToolMenuEntityDetail`) and top-level wiring.
 *
 * **Public contract fixed by an already-landed sibling caller.**
 * `features/agents/ui/ApplicationTools.tsx` (sibling sub-unit, already in
 * this worktree) renders `<ToolMenu applicationId={applicationId} />` with
 * ONLY an `applicationId` prop — no `versionId`, no Formik context. This
 * component therefore resolves its own `versionId`/`agent_type`/current
 * `tools` by fetching the application's own detail via `useGetApplication`
 * (`useToolMenuEntityDetail` below), rather than requiring them as props the
 * way the baseline pulled them from `useFormikContext()`. `onToolsChanged`
 * is an ADDITIONAL, optional prop (not on `ApplicationTools`' current call
 * site) for a future caller that DOES own a separate `tools` list (e.g. the
 * real `ApplicationTools`'s own `tools` prop) to know when to refetch it —
 * see the "known integration gap" paragraph below.
 *
 * **REAL GAPS, disclosed (not invented around):**
 *  - No generated toolkit-association/assign endpoint exists at all
 *    (grepped `shared/api/generated/toolkits/toolkits.ts` — only
 *    `listToolkits`/`listToolkitInstances`). The Toolkit/MCP dropdowns list
 *    real toolkit instances (`useListToolkitInstances`) but the actual
 *    "attach" action is injected via `onAttachToolkit`/`onAttachMcp` rather
 *    than invented; with neither supplied, selecting an item just closes
 *    the menu.
 *  - `ListToolkitInstancesParams` only has `limit`/`offset` — no
 *    server-side search, so the toolkit/MCP search box filters the already-
 *    fetched page client-side (same tolerant-degradation style
 *    `entities/toolkit`'s own `toolkitTypeMenuEntries` uses elsewhere).
 *  - `ListApplicationsParams` (agents/pipelines) has no page/pageSize
 *    param at all — the baseline's infinite-scroll agent/pipeline lists
 *    have no server-side "load more" to page through; this shows whatever
 *    the one available page returns, filtered by the search box (which DOES
 *    map onto the real `query` param).
 *  - `Application` (the generated agent/pipeline list-row type) has no
 *    `has_swarm`/`icon_meta` fields — the baseline's swarm-agent list
 *    filter and rich per-entry icon are both dropped; `Application.icon`
 *    (a plain URL string) is passed to `EntityIcon` instead.
 *  - Known integration gap: `updateApplicationRelation`'s response carries
 *    no `tool_id` (see `useAgentPipelineAssociation.tsx`'s own doc
 *    comment) — after a successful agent/pipeline attach, this component
 *    invalidates its OWN `getGetApplicationQueryOptions` cache entry (so
 *    its internal "already added" / "unsaved" state stays correct) and
 *    calls `onToolsChanged`, but has no way to push the new tool into a
 *    SEPARATE `tools` list a parent component (e.g. the real
 *    `ApplicationTools`) owns — that parent must refetch its own copy on
 *    `onToolsChanged` too.
 *
 * **"Create new toolkit" round trip — inbound half (baseline's
 * `handleAddNewlyCreatedToolkit`/its `newToolkitId` watcher-effect,
 * `ToolMenu.jsx:172-230`).** `ToolMenuSections.tsx`'s `InstanceAddSection`
 * owns the OUTBOUND half (navigating to toolkit/MCP creation with
 * `SearchParams.ReturnUrl`/`SearchParams.SourceApplicationId` — see that
 * file's own module doc comment); this component owns the return watch.
 * `useSearch({ strict: false })` (this component isn't bound to one
 * specific route — `ApplicationTools.tsx` mounts it on both the agent and
 * pipeline editors) reads a returned `?newToolkitId=`/`?mcp=` pair, matches
 * it against the already-fetched `useToolkitInstanceRows` page, and — if
 * found — calls `onAttachToolkit`/`onAttachMcp` (the same injected callback
 * a manual dropdown click uses) before clearing all four round-trip params
 * from the URL. Two real, disclosed limits on this, not invented around:
 *  - No get-single-toolkit-by-id endpoint exists (only `listToolkitInstances`,
 *    `limit`/`offset`, no id filter — same gap the "no server-side search"
 *    bullet above already flags) — unlike baseline's dedicated
 *    `fetchToolkitDetails` unwrap call, this can only match against
 *    whatever page is ALREADY loaded. A newly created toolkit that sorts
 *    outside the current page (alphabetically, past `instanceLimit`) is
 *    invisible to this match and the round trip silently no-ops (URL still
 *    gets cleaned up, matching baseline's own "clean up even on failure"
 *    behaviour) rather than falling back to a toast the way baseline did —
 *    no toast/notification callback is threaded through this component.
 *  - The RETURN navigation itself (a not-yet-built toolkit-creation page
 *    reading `SearchParams.ReturnUrl`/`SourceApplicationId` and appending
 *    `?newToolkitId=`/`?mcp=` on save) is out of this unit's ownership
 *    fence — this effect only reacts to those params if and when some
 *    future page sets them; it is independently correct and testable
 *    regardless of who sets them.
 */
export interface ToolMenuProps {
  readonly applicationId?: number | string | undefined;
  /** Called after a successful agent/pipeline attach — see the module doc comment's "known integration gap" paragraph. */
  readonly onToolsChanged?: (() => void) | undefined;
  /** Injected — see the module doc comment; no generated endpoint exists to call directly. */
  readonly onAttachToolkit?: ((toolkit: Toolkit) => void) | undefined;
  readonly onAttachMcp?: ((toolkit: Toolkit) => void) | undefined;
}

const containerSx: SxProps<Theme> = { display: 'flex', gap: 1, alignItems: 'center', maxWidth: '100%', flexWrap: 'wrap' };
const EMPTY_APPLICATIONS: readonly Application[] = [];
/** Not in `SearchParams` (`@/shared/lib/params`) — the baseline never put it in `constants.js` either (`ToolMenu.jsx:217`'s `searchParams.get('newToolkitId')` is a raw literal), only `src/routes/-search/params.ts`'s `paramSchemas.newToolkitId` registers it. */
const NEW_TOOLKIT_ID_PARAM = 'newToolkitId';

function toApplicationTool(tool: unknown): AgentToolAssociation {
  return tool as AgentToolAssociation;
}

function computeAddedToolkitIds(currentTools: readonly AgentToolAssociation[]): ReadonlySet<string | number> {
  const ids = currentTools
    .filter((tool) => tool.type !== 'application')
    .map((tool) => tool.id)
    .filter((id): id is string | number => id !== undefined);
  return new Set(ids);
}

function resolveEntityLabel(agentType: string | undefined): 'agent' | 'pipeline' {
  return agentType === 'pipeline' ? 'pipeline' : 'agent';
}

/* ── the application/version this ToolMenu is attached to ─────────────────── */

interface ToolMenuEntityDetail {
  readonly numericApplicationId: number | undefined;
  readonly versionId: number | undefined;
  readonly isEntityUnsaved: boolean;
  readonly entityLabel: 'agent' | 'pipeline';
  readonly currentTools: readonly AgentToolAssociation[];
  readonly addedToolkitIds: ReadonlySet<string | number>;
}

function useToolMenuEntityDetail(applicationId: number | string | undefined, projectId: string | undefined): ToolMenuEntityDetail {
  const numericApplicationId = applicationId === undefined ? undefined : Number(applicationId);
  const applicationQuery = useGetApplication(projectId ?? '', numericApplicationId ?? 0, {
    query: { enabled: projectId !== undefined && numericApplicationId !== undefined },
  });
  // Same error-envelope-unreachable cast as every other Wave-2 generated-client caller (eliteaFetch throws instead of resolving with the error variant).
  const versionDetails = (applicationQuery.data as { data: ApplicationDetail } | undefined)?.data.version_details;
  const versionId = versionDetails === undefined || versionDetails.id === undefined ? undefined : Number(versionDetails.id);
  const currentTools = useMemo(() => (versionDetails?.tools ?? []).map(toApplicationTool), [versionDetails?.tools]);
  const addedToolkitIds = useMemo(() => computeAddedToolkitIds(currentTools), [currentTools]);

  return {
    numericApplicationId,
    versionId,
    isEntityUnsaved: numericApplicationId === undefined || versionId === undefined,
    entityLabel: resolveEntityLabel(versionDetails?.agent_type),
    currentTools,
    addedToolkitIds,
  };
}

export function ToolMenu({ applicationId, onToolsChanged, onAttachToolkit, onAttachMcp }: ToolMenuProps): ReactNode {
  const projectId = useSelectedProjectId();
  const queryClient = useQueryClient();
  const isMcpVisible = useIsMcpVisible();

  const { numericApplicationId, versionId, isEntityUnsaved, entityLabel, currentTools, addedToolkitIds } = useToolMenuEntityDetail(applicationId, projectId);
  const { filterAgents, filterPipelines } = useFilterAddedItems(currentTools);

  // `getToolIcon` (agent/pipeline flat icon, faithfully ported) is also returned by this hook
  // for callers that render a tool CARD icon elsewhere (e.g. sibling A1h's `ToolCard`) — not
  // used by this component's own markup, which uses `EntityIcon`'s gradient-badge treatment
  // for menu ROWS instead, matching the baseline's own two-different-icon-treatments split.
  const { associateAgent } = useAgentPipelineAssociation({ projectId, applicationId: numericApplicationId, versionId });

  const onAssociated = useCallback(async () => {
    if (projectId !== undefined && numericApplicationId !== undefined) {
      await queryClient.invalidateQueries({ queryKey: getGetApplicationQueryKey(projectId, numericApplicationId) });
    }
    onToolsChanged?.();
  }, [projectId, numericApplicationId, queryClient, onToolsChanged]);

  const associateAsAgent = useCallback(
    (candidate: AssociationCandidate) => {
      void associateAgent(candidate, { isPipeline: false, currentTools }).then((outcome) => {
        if (outcome.ok) void onAssociated();
      });
    },
    [associateAgent, currentTools, onAssociated],
  );
  const associateAsPipeline = useCallback(
    (candidate: AssociationCandidate) => {
      void associateAgent(candidate, { isPipeline: true, currentTools }).then((outcome) => {
        if (outcome.ok) void onAssociated();
      });
    },
    [associateAgent, currentTools, onAssociated],
  );

  const [instanceLimit, setInstanceLimit] = useState(20);
  const loadMoreInstances = useCallback(() => setInstanceLimit((prev) => prev + 20), []);
  const { rows: instanceRows, isFetching: instancesFetching } = useToolkitInstanceRows(projectId, instanceLimit);

  // "Create new toolkit" round trip — inbound half. See this module's own doc comment.
  const navigate = useNavigate();
  const returnSearch = useSearch({ strict: false }) as Readonly<Record<string, unknown>>;
  const processedReturnedToolkitIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const rawNewToolkitId = returnSearch[NEW_TOOLKIT_ID_PARAM];
    const newToolkitId = typeof rawNewToolkitId === 'string' ? rawNewToolkitId : undefined;
    if (newToolkitId === undefined || isEntityUnsaved || instancesFetching) return;
    if (processedReturnedToolkitIds.current.has(newToolkitId)) return;
    processedReturnedToolkitIds.current.add(newToolkitId);

    const matched = instanceRows.find((row) => String(row.id) === newToolkitId);
    if (matched !== undefined) {
      const isMcpReturn = returnSearch[SearchParams.IsMCP] === 'true' || returnSearch[SearchParams.IsMCP] === '1';
      (isMcpReturn ? onAttachMcp : onAttachToolkit)?.(matched);
    }

    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        delete next[NEW_TOOLKIT_ID_PARAM];
        delete next[SearchParams.IsMCP];
        delete next[SearchParams.SourceApplicationId];
        delete next[SearchParams.ReturnUrl];
        return next;
      },
      replace: true,
    });
  }, [returnSearch, isEntityUnsaved, instancesFetching, instanceRows, onAttachToolkit, onAttachMcp, navigate]);

  const [agentAnchor, setAgentAnchor] = useState<HTMLElement | null>(null);
  const [agentSearch, setAgentSearch] = useState('');
  const [pipelineAnchor, setPipelineAnchor] = useState<HTMLElement | null>(null);
  const [pipelineSearch, setPipelineSearch] = useState('');
  const closeAgentMenu = useCallback(() => {
    setAgentAnchor(null);
    setAgentSearch('');
  }, []);
  const closePipelineMenu = useCallback(() => {
    setPipelineAnchor(null);
    setPipelineSearch('');
  }, []);

  const agentsQuery = useListApplications(projectId ?? '', { agents_type: 'classic', query: agentSearch }, { query: { enabled: projectId !== undefined } });
  const pipelinesQuery = useListApplications(projectId ?? '', { agents_type: 'pipeline', query: pipelineSearch }, { query: { enabled: projectId !== undefined } });
  const agentRows = (agentsQuery.data as { data?: { rows?: Application[] } } | undefined)?.data?.rows ?? EMPTY_APPLICATIONS;
  const pipelineRows = (pipelinesQuery.data as { data?: { rows?: Application[] } } | undefined)?.data?.rows ?? EMPTY_APPLICATIONS;

  const agentItems = useEntityAssociationItems(agentRows, numericApplicationId, filterAgents, 'agent', associateAsAgent);
  const pipelineItems = useEntityAssociationItems(pipelineRows, numericApplicationId, filterPipelines, 'pipeline', associateAsPipeline);

  const savedFirstTooltip = t('agents.toolMenu.saveFirst', 'Save the {{entity}} first, then add tools', { entity: entityLabel });

  return (
    <Box sx={containerSx}>
      <InstanceAddSection
        copy={{ label: t('agents.toolMenu.toolkit', 'Toolkit'), searchPlaceholder: t('agents.toolMenu.searchToolkits', 'Search toolkits...'), emptyMessage: t('agents.toolMenu.noToolkits', 'No toolkits available') }}
        testId="agent-add-toolkit-button"
        isEntityUnsaved={isEntityUnsaved}
        tooltip={savedFirstTooltip}
        isMcp={false}
        rows={instanceRows}
        addedToolkitIds={addedToolkitIds}
        isFetching={instancesFetching}
        onAttach={onAttachToolkit}
        onLoadMore={loadMoreInstances}
        createRoute="/toolkits/create"
        sourceApplicationId={numericApplicationId}
      />

      {isMcpVisible && (
        <InstanceAddSection
          copy={{ label: t('agents.toolMenu.mcp', 'MCP'), searchPlaceholder: t('agents.toolMenu.searchMcps', 'Search mcps...'), emptyMessage: t('agents.toolMenu.noMcps', 'No mcps available') }}
          isEntityUnsaved={isEntityUnsaved}
          tooltip={savedFirstTooltip}
          isMcp={true}
          rows={instanceRows}
          addedToolkitIds={addedToolkitIds}
          isFetching={instancesFetching}
          onAttach={onAttachMcp}
          onLoadMore={loadMoreInstances}
          createRoute="/mcps/create"
          sourceApplicationId={numericApplicationId}
        />
      )}

      <EntityAddSection
        copy={{ label: t('agents.toolMenu.agent', 'Agent'), searchPlaceholder: t('agents.toolMenu.searchAgents', 'Search agents...'), emptyMessage: t('agents.toolMenu.noAgents', 'No agents available') }}
        isEntityUnsaved={isEntityUnsaved}
        tooltip={savedFirstTooltip}
        items={agentItems}
        isFetching={agentsQuery.isFetching}
        search={agentSearch}
        onSearchChange={setAgentSearch}
        onOpen={setAgentAnchor}
        anchor={agentAnchor}
        onClose={closeAgentMenu}
      />

      <EntityAddSection
        copy={{ label: t('agents.toolMenu.pipeline', 'Pipeline'), searchPlaceholder: t('agents.toolMenu.searchPipelines', 'Search pipelines...'), emptyMessage: t('agents.toolMenu.noPipelines', 'No pipelines available') }}
        isEntityUnsaved={isEntityUnsaved}
        tooltip={savedFirstTooltip}
        items={pipelineItems}
        isFetching={pipelinesQuery.isFetching}
        search={pipelineSearch}
        onSearchChange={setPipelineSearch}
        onOpen={setPipelineAnchor}
        anchor={pipelineAnchor}
        onClose={closePipelineMenu}
      />
    </Box>
  );
}
