/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/
 * useLoadToolkits.js` (333 lines, Wave-2 unit A4b) — the toolkit-list data
 * hook backing `ToolkitsList.jsx`'s card/table views.
 *
 * FOUR real, disclosed deviations from the baseline, each forced by a
 * verified constraint (not a shortcut):
 *
 *  1. **No server-side filtering beyond pagination — the dominant gap.**
 *     The baseline's `useToolkitsListQuery` accepts `query`/`sort_by`/
 *     `sort_order`/`mcp`/`application`/`toolkit_type`/`author_id`/
 *     `statuses`/`tags`/`search_artifact`. The generated
 *     `ListToolkitInstancesParams` (`shared/api/generated/model/
 *     listToolkitInstancesParams.zod.ts`) has exactly TWO fields: `limit`,
 *     `offset` — grepped and read in full, not assumed. There is no way to
 *     ask the real backend to search, sort, or filter toolkit instances
 *     server-side. Rather than silently keep the baseline's filter
 *     parameters as inert no-ops (this codebase's own "no placeholder
 *     code" rule), this hook's params surface only exposes what the
 *     generated endpoint actually accepts (`page`/`pageSize`) plus
 *     `isMCP`/`authorId`, which drive CLIENT-SIDE presentation decisions
 *     over whatever page of rows comes back (icon/label resolution, which
 *     tag-list variant to show) — never a request-shaping filter. A
 *     future backend enrichment of this endpoint should re-add the
 *     dropped params here.
 *  2. **No card/table dual-parallel-query.** The baseline runs TWO
 *     independent `useLoadToolkitData` instances (one per view) so
 *     switching views doesn't lose the other's scroll/pagination position.
 *     With point 3 below moving page ownership to the caller, that
 *     "which view is this instance's state for" duplication becomes the
 *     CALLER's composition choice (call this hook twice, once per view, if
 *     that UX is wanted) rather than baked into the hook — a direct,
 *     disclosed consequence of point 3, not an independent cut.
 *  3. **Pagination/URL-param ownership moves to the caller.** The baseline
 *     composes `usePageQuery`/`useSortQueryParamsFromUrl`/`useTypes`
 *     (`hooks/toolkit/useTypes.js` — react-router-dom `useLocation`/
 *     `useNavigate`, a different sub-unit's file, not owned here) to read
 *     page/sort/type-filter state from the URL. `react-router-dom` does not
 *     exist in this app (R1 replaced it with TanStack Router); `page`/
 *     `pageSize`/`onPageChange` are explicit parameters instead — the
 *     SAME "ambient URL/context -> parameter" convention already
 *     established for comparable hooks this session (e.g.
 *     `features/agents/model/useCreateApplication.ts`,
 *     `features/pipelines/lib/flow-editor/hooks/
 *     useGetToolkitNameFromSchema.ts`'s own "DISCLOSED REDESIGN" sections).
 *     A page/route-layer caller reads `page`/`sort_by`/`sort_order` off its
 *     own `validateSearch`-typed search params (already registered in
 *     `src/routes/-search/params.ts`) and passes them in.
 *  4. **No `useTheme()`.** Only used by the baseline to colour
 *     `ToolkitsHelpers.enhanceToolkitData`'s per-brand icon — this app's
 *     `../helpers/toolkits.helpers.ts` port of that function already drops
 *     the per-brand icon lookup (see that file's own module doc comment,
 *     point 4), so the theme argument has nothing left to do.
 */
import { useCallback, useMemo } from 'react';

import { providerDisplayName } from '@/entities/credential';
import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { useListToolkitInstances } from '@/shared/api/generated/toolkits/toolkits';

import { McpCategory } from '../constants/mcp.constants';
import { enhanceToolkitData, type EnhanceableToolkit, type EnhancedToolkit } from '../helpers/toolkits.helpers';
import { useGetCurrentToolkitSchemas } from './useGetCurrentToolkitSchemas.hooks';
import { useSelectedProjectId } from './useSelectedProjectId';

/** Not exported: no current caller needs these two apart from `UseLoadToolkitsResult` below. */
interface ToolkitTag {
  readonly id: string | number;
  readonly name: string;
  readonly data: { readonly type: string };
}

interface LoadedToolkit extends EnhanceableToolkit {
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly ToolkitTag[];
}

export interface UseLoadToolkitsParams {
  readonly isMCP?: boolean;
  readonly projectId?: string;
  readonly page: number;
  readonly pageSize: number;
  /** Presence (not value) selects between `projectWideTagList`/the MCP local-vs-remote pair and the per-page tag list derived from the fetched rows — mirrors the baseline's `author_id ? ... : ...` branch, which never filtered BY author_id server-side either (`useToolkitsListQuery`'s `author_id` param has no generated-endpoint equivalent — see module doc comment point 1). */
  readonly authorId?: string;
  readonly skip?: boolean;
}

export interface UseLoadToolkitsResult {
  readonly tagList: readonly ToolkitTag[];
  readonly data: readonly EnhancedToolkit<LoadedToolkit>[] | undefined;
  readonly isToolkitsError: boolean;
  readonly isToolkitsFetching: boolean;
  readonly isToolkitsLoading: boolean;
  readonly totalCount: number;
  /** `(page + 1) * pageSize < totalCount` — replaces the baseline's `onLoadMoreToolkits()` callback (which called its OWN internal `setPage(page + 1)`); with pagination caller-owned (module doc comment point 3), this hook can only report whether advancing is meaningful, not perform it. */
  readonly hasMore: boolean;
  readonly refetchToolkits: () => void;
}

/** Unique-by-`id`, name-sorted tags flattened out of the current page's rows — the baseline's own `tagList` in `useLoadToolkitData` (built from the SAME per-page `toolkitData?.rows`, not a separate full-catalogue fetch). */
function collectRowTags(rows: readonly LoadedToolkit[] | undefined): readonly ToolkitTag[] {
  const allTags = (rows ?? []).flatMap((toolkit) => toolkit.tags ?? []);
  const seenIds = new Set<string | number>();
  const uniqueTags: ToolkitTag[] = [];
  for (const tag of allTags) {
    if (tag.id && !seenIds.has(tag.id)) {
      seenIds.add(tag.id);
      uniqueTags.push(tag);
    }
  }
  return uniqueTags.sort((a, b) => a.name.localeCompare(b.name));
}

/** One toolkit TYPE's display label — schema `metadata.label`, else `entities/credential`'s `providerDisplayName` on the capitalized type name (baseline: `CredentialNameHelpers.extraCredentialName`). */
function toolkitTypeLabel(type: string, toolkitSchemas: ToolkitTypeSchemaMap | undefined): string {
  const typeInfo = toolkitSchemas?.[type] as { readonly metadata?: { readonly label?: string } } | undefined;
  return typeInfo?.metadata?.label ?? providerDisplayName(type.charAt(0).toUpperCase() + type.slice(1));
}

/** `projectWideTagList` — every known toolkit TYPE (from the schema catalogue) as a selectable tag, name-sorted. */
function buildProjectWideTagList(toolkitSchemas: ToolkitTypeSchemaMap | undefined): readonly ToolkitTag[] {
  return Object.keys(toolkitSchemas ?? {})
    .map((type, index) => ({ id: index + 1, name: toolkitTypeLabel(type, toolkitSchemas), data: { type } }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The MCP tab's fixed two-entry tag list (`Local`/`Remote`), independent of the schema catalogue. */
const MCP_TAG_LIST: readonly ToolkitTag[] = [
  { id: 1, name: McpCategory.Local, data: { type: 'local' } },
  { id: 2, name: McpCategory.Remote, data: { type: 'mcp' } },
];

/** `tagList`'s own resolution branch, split out of the hook body to stay under the §3.5 complexity budget. */
function resolveTagList(
  authorId: string | undefined,
  isMCP: boolean,
  rows: readonly LoadedToolkit[] | undefined,
  toolkitSchemas: ToolkitTypeSchemaMap | undefined,
): readonly ToolkitTag[] {
  if (authorId !== undefined) return collectRowTags(rows);
  if (isMCP) return MCP_TAG_LIST;
  return buildProjectWideTagList(toolkitSchemas);
}

export function useLoadToolkits(params: UseLoadToolkitsParams): UseLoadToolkitsResult {
  const { isMCP = false, page, pageSize, authorId, skip = false } = params;
  const fallbackProjectId = useSelectedProjectId();
  const projectId = params.projectId ?? fallbackProjectId;

  const { toolkitSchemas } = useGetCurrentToolkitSchemas({ isMCP });

  const query = useListToolkitInstances(
    projectId ?? '',
    { limit: pageSize, offset: page * pageSize },
    { query: { enabled: !skip && projectId !== undefined } },
  );
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const toolkitData = query.data?.data as { readonly rows: readonly LoadedToolkit[]; readonly total: number } | undefined;

  const data = useMemo(() => enhanceToolkitData(toolkitData?.rows, toolkitSchemas ?? {}, isMCP), [toolkitData?.rows, toolkitSchemas, isMCP]);

  const tagList = useMemo(
    () => resolveTagList(authorId, isMCP, toolkitData?.rows, toolkitSchemas),
    [authorId, isMCP, toolkitData?.rows, toolkitSchemas],
  );

  const totalCount = toolkitData?.total ?? 0;
  const hasMore = !query.isFetching && (page + 1) * pageSize < totalCount;

  const refetchToolkits = useCallback(() => {
    void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `query.refetch` is a stable TanStack Query identity per query key
  }, [query.refetch]);

  return {
    tagList,
    data,
    isToolkitsError: query.isError,
    isToolkitsFetching: query.isFetching,
    isToolkitsLoading: query.isLoading,
    totalCount,
    hasMore,
    refetchToolkits,
  };
}
