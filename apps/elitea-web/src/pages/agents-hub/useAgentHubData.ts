/* oxlint-disable eslint/no-restricted-globals -- Wave-2 backend-gap: spec §6.5 — the OpenAPI spec only declares ?category, but the handler accepts page/pageSize/statuses/agents_type/trend_start_period/sort_by/sort_order/my_liked; we pass them through as raw query params via global fetch. REMOVER: when spec is updated and typed client is generated. */
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
 * @public Wave-2 unit A13 surface.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useGetAgentCategories,
} from '@/shared/api/generated/applications/applications';
import type { ApplicationData } from './types';

import {
  TRENDING_CATEGORY,
  MY_LIKED_CATEGORY,
  PAGE_SIZE,
  ALL_AGENTS_LIMIT,
} from './constants';
import { buildAllCategories, getCategoryForApplication } from './helpers';

/**
 * Public project ID constant (shared across wave-2).
 */
const PUBLIC_PROJECT_ID = '1';

/* ── Helpers ──────────────────────────────────────────────────────────── */

/**
 * Fetch a flat list of all published applications.
 * Backend gap: the OpenAPI spec only declares ?category, but the handler
 * accepts page, pageSize, statuses, agents_type, trend_start_period,
 * sort_by, sort_order, my_liked — we pass them through as query params.
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
  const { data: categoriesData, isFetching: isFetchingCategories } = useGetAgentCategories(
    PUBLIC_PROJECT_ID,
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
