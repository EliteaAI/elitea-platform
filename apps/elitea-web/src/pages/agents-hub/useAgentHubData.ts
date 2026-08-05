/* oxlint-disable eslint/no-restricted-globals -- Wave-2 backend-gap: spec §6.5 — the OpenAPI spec only declares ?category, and (contrary to this rule's original wording) the handler reads ONLY that one param; page/pageSize/statuses/agents_type/trend_start_period/sort_by/sort_order/my_liked are sent for forward-compat/documented intent but are silently ignored server-side today (see the module doc comment below). REMOVER: when spec is updated and typed client is generated. */
/**
 * Agent Hub data hook — local port of the old Redux-based `useAgentHubData`.
 *
 * Strategy: fetch ALL published agents in a single request, then bucket them
 * client-side by their category tag. Special buckets (Trending, My Liked)
 * still use their own targeted requests.
 *
 * Uses the generated `listPublicApplications` API + custom fetch for
 * trending/my-liked (which need additional params not yet in the OpenAPI
 * spec — a documented backend gap, spec §6.5).
 *
 * ── Confirmed, disclosed backend defects (adversarial-review fixes,
 *    cluster A13-agents-hub, findings 5 & 6) — NOT fixable from this file ──
 *
 * `PublicApplications` (`internal/api/v2/eliteacore/handler.go`, the
 * handler behind `GET /elitea_core/public_applications/prompt_lib`) was
 * read directly to confirm both of these:
 *
 *  1. It parses exactly ONE query param, `category` — `page`, `pageSize`,
 *     `statuses`, `sort_by`, `sort_order`, and `my_liked` are all silently
 *     ignored. So `fetchMyLiked`'s `my_liked: 'true'` has zero effect: every
 *     user gets the identical generic list under a section labelled "My
 *     Liked" (finding 5), and `fetchTrending`'s `sort_by: 'likes'` /
 *     `sort_order: 'desc'` also have zero effect (finding 6) — the SQL is
 *     hardcoded to `ORDER BY a.id DESC`. Worse for "Trending": the response
 *     shape the handler emits per row (`project_id`, `id`, `name`,
 *     `description`, `version_id`, `version_name`, `agent_type`, `meta`)
 *     carries no `likes`/`is_liked` field AT ALL — not on this list
 *     endpoint, not on the per-agent detail endpoint either — so there is
 *     no data anywhere in this API surface a client could sort or filter on
 *     to approximate either feature honestly. Params are still sent (kept
 *     for wire-shape/intent parity, same convention
 *     `features/analytics/api/useAnalytics.ts` documents for its own
 *     backend-ignores-these-params case) so the client is already correct
 *     the moment the handler is fixed.
 *  2. The SQL hardcodes `LIMIT 50` regardless of the requested `pageSize`
 *     (`ALL_AGENTS_LIMIT` below is sent but has no effect) — the same class
 *     of hardcoded-truncation defect already confirmed in unit A1
 *     (`pages/agents/Latest.tsx`'s own doc comment). Every bucket this hook
 *     produces (bulk-categorized, Trending, and My Liked alike) is capped
 *     at 50 rows total, full stop — there is no "load more" request that
 *     could reach row 51; `AgentCategorySection`'s "Show more" only reveals
 *     more of what's already in memory (same precedent as `Latest.tsx`).
 *
 * Fixing either defect requires changing `PublicApplications` in
 * `services/elitea-main/internal/api/v2/eliteacore/handler.go` — outside
 * this cluster's (`apps/elitea-web`) file scope. My Liked additionally
 * needs the handler to join `centry`/`p_*`'s `social_likes` table filtered
 * by the current user, and Trending needs a real `likes` count to sort by
 * (neither exists in this schema today per the same read).
 *
 * @public Wave-2 unit A13 surface.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useGetAgentCategories,
} from '@/shared/api/generated/applications/applications';
import { getConfig } from '@/shared/config';
import type { ApplicationData } from './types';

import {
  TRENDING_CATEGORY,
  MY_LIKED_CATEGORY,
  PAGE_SIZE,
  ALL_AGENTS_LIMIT,
} from './constants';
import { buildAllCategories, getCategoryForApplication } from './helpers';

/**
 * Public project id — per-deployment `VITE_PUBLIC_PROJECT_ID` runtime
 * config, read via `shared/config`'s `getConfig()` (adversarial-review fix,
 * cluster A13-agents-hub, finding 7: this was hardcoded to the literal
 * `'1'`, so any deployment whose real public project id differs queried the
 * wrong project's `agent_categories` and got zero categories back). Same
 * `getConfig()` convention every other `PUBLIC_PROJECT_ID` consumer in this
 * codebase uses — see e.g. `pages/agents/lib/isPublicAgentsProject.ts`.
 * `App.tsx` (unit R2) renders `MissingEnvPage` instead of mounting any route
 * when config status is `'missing'`, so by the time this hook runs config
 * is always `'ok'` — the `'1'` fallback below is unreachable in practice
 * and exists only so this stays a total function instead of throwing.
 */
function resolvePublicProjectId(): string {
  const config = getConfig();
  return config.status === 'ok' ? config.config.vite_public_project_id : '1';
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Fetch a flat list of all published applications.
 * Backend gap: the OpenAPI spec only declares ?category, and the handler
 * reads only that one param — page, pageSize, statuses, agents_type,
 * trend_start_period, sort_by, sort_order, my_liked are all sent (for
 * forward-compat / documented intent) but silently ignored server-side
 * today. See this module's top-of-file doc comment for the full,
 * confirmed defect writeup.
 */
async function fetchAllApplications(params: Record<string, string>): Promise<{ rows: ApplicationData[]; total: number }> {
  const qs = new URLSearchParams(params);
  const resp = await fetch(`/elitea_core/public_applications/prompt_lib?${qs.toString()}`);
  if (!resp.ok) throw new Error(`public_applications: ${resp.status}`);
  const json = (await resp.json()) as { data?: { rows: ApplicationData[]; total: number } };
  return { rows: json.data?.rows || [], total: json.data?.total || 0 };
}

/* ── Hook ─────────────────────────────────────────────────────────────── */

export function useAgentHubData(_selectedTagNames: string[]) {
  const publicProjectId = resolvePublicProjectId();
  const { data: categoriesData, isFetching: isFetchingCategories } = useGetAgentCategories(
    publicProjectId,
    { query: { enabled: true } },
  );

  const categoryNames = useMemo(() => {
    if (!categoriesData || categoriesData.status !== 200) return [];
    return (categoriesData.data.categories || []).map((c: { name: string }) => c.name);
  }, [categoriesData]);

  const [applicationsByTag, setApplicationsByTag] = useState<Record<string, ApplicationData[]>>({});
  const [totalCountsByTag, setTotalCountsByTag] = useState<Record<string, number>>({});
  const [loadingTags, setLoadingTags] = useState<Set<string>>(new Set());
  const [refreshingTags, setRefreshingTags] = useState<Set<string>>(new Set());

  // ── Bulk fetch: one request for all, bucket client-side ──────────────
  const fetchAllAndCategorize = useCallback(async () => {
    setLoadingTags(prev => new Set(prev).add('bulk'));
    try {
      const result = await fetchAllApplications({
        page: '0',
        pageSize: String(ALL_AGENTS_LIMIT),
        statuses: 'published',
      });
      const buckets: Record<string, ApplicationData[]> = {};
      result.rows.forEach((app: ApplicationData) => {
        const cat = getCategoryForApplication(app);
        if (!buckets[cat]) buckets[cat] = [];
        buckets[cat].push(app);
      });
      setApplicationsByTag(buckets);
      setTotalCountsByTag(
        Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
      );
    } finally {
      setLoadingTags(prev => {
        const s = new Set(prev);
        s.delete('bulk');
        return s;
      });
    }
  }, []);

  // ── Trending: sorted by likes ────────────────────────────────────────
  const fetchTrending = useCallback(async () => {
    setLoadingTags(prev => new Set(prev).add(TRENDING_CATEGORY));
    try {
      const result = await fetchAllApplications({
        pageSize: String(PAGE_SIZE),
        statuses: 'published',
        sort_by: 'likes',
        sort_order: 'desc',
      });
      setApplicationsByTag(prev => ({
        ...prev,
        [TRENDING_CATEGORY]: result.rows,
      }));
      setTotalCountsByTag(prev => ({
        ...prev,
        [TRENDING_CATEGORY]: result.total,
      }));
    } finally {
      setLoadingTags(prev => {
        const s = new Set(prev);
        s.delete(TRENDING_CATEGORY);
        return s;
      });
    }
  }, []);

  // ── My Liked ─────────────────────────────────────────────────────────
  const fetchMyLiked = useCallback(async () => {
    setLoadingTags(prev => new Set(prev).add(MY_LIKED_CATEGORY));
    try {
      const result = await fetchAllApplications({
        pageSize: String(PAGE_SIZE),
        statuses: 'published',
        my_liked: 'true',
      });
      setApplicationsByTag(prev => ({
        ...prev,
        [MY_LIKED_CATEGORY]: result.rows,
      }));
      setTotalCountsByTag(prev => ({
        ...prev,
        [MY_LIKED_CATEGORY]: result.total,
      }));
    } finally {
      setLoadingTags(prev => {
        const s = new Set(prev);
        s.delete(MY_LIKED_CATEGORY);
        return s;
      });
    }
  }, []);

  // ── Main fetch effect ────────────────────────────────────────────────
  useEffect(() => {
    if (categoryNames.length === 0) return;
    void fetchAllAndCategorize();
    void fetchTrending();
    void fetchMyLiked();
  }, [categoryNames.length, fetchAllAndCategorize, fetchTrending, fetchMyLiked]);

  // ── Derived data ─────────────────────────────────────────────────────
  const allCategories = useMemo(
    () => buildAllCategories(categoryNames),
    [categoryNames],
  );

  const isFetching = useMemo(
    () => loadingTags.size > 0 || isFetchingCategories,
    [loadingTags.size, isFetchingCategories],
  );

  // ── State updates ────────────────────────────────────────────────────
  const updateApplicationInState = useCallback(
    (applicationId: string, updateFn: (app: ApplicationData) => ApplicationData) => {
      setApplicationsByTag(prev => {
        const updated: Record<string, ApplicationData[]> = {};
        Object.keys(prev).forEach(cat => {
          const list = prev[cat];
          if (!list) return;
          updated[cat] = list.map(app =>
            app.id === applicationId ? updateFn(app) : app,
          );
        });
        return updated;
      });
    },
    [],
  );

  const addToMyLiked = useCallback((application: ApplicationData) => {
    setApplicationsByTag(prev => ({
      ...prev,
      [MY_LIKED_CATEGORY]: [...(prev[MY_LIKED_CATEGORY] || []), application],
    }));
  }, []);

  const removeFromMyLiked = useCallback((applicationId: string) => {
    setApplicationsByTag(prev => ({
      ...prev,
      [MY_LIKED_CATEGORY]: (prev[MY_LIKED_CATEGORY] || []).filter(a => a.id !== applicationId),
    }));
  }, []);

  const onRefresh = useCallback(
    async (category: string) => {
      setRefreshingTags(prev => new Set(prev).add(category));
      try {
        if (category === TRENDING_CATEGORY) {
          await fetchTrending();
        } else if (category === MY_LIKED_CATEGORY) {
          await fetchMyLiked();
        } else {
          await fetchAllAndCategorize();
        }
      } finally {
        setRefreshingTags(prev => {
          const s = new Set(prev);
          s.delete(category);
          return s;
        });
      }
    },
    [fetchTrending, fetchMyLiked, fetchAllAndCategorize],
  );

  // ── Filtered data (by selected tags) ─────────────────────────────────
  const filteredByTag = useMemo(() => {
    if (_selectedTagNames.length === 0) return applicationsByTag;
    const filtered: Record<string, ApplicationData[]> = {};
    _selectedTagNames.forEach((tag: string) => {
      if (applicationsByTag[tag]) filtered[tag] = applicationsByTag[tag];
    });
    return filtered;
  }, [applicationsByTag, _selectedTagNames]);

  return {
    categoryNames,
    allCategories,
    applicationsByTag: filteredByTag,
    totalCountsByTag,
    loadingTags,
    refreshingTags,
    isFetching,
    updateApplicationInState,
    addToMyLiked,
    removeFromMyLiked,
    onRefresh,
  };
}
