/**
 * useConfigurationsBySection — fetches configurations for all sections in parallel.
 * Ported from `apps/elitea-ui/src/hooks/credentials/useMultiSectionConfigurations.js`.
 */
import { useMemo } from 'react';

import {
  getConfigurationsList,
  type ConfigurationItem,
} from '@/shared/api/configurationsApi';
import { useQueries } from '@tanstack/react-query';

/* ── section constants ──────────────────────────────────────────────────── */

const SECTIONS = [
  'llm',
  'embedding',
  'vectorstorage',
  'image_generation',
  'asr',
  'tts',
  'ai_credentials',
] as const;

export type Section = (typeof SECTIONS)[number];

/** Map of section-name → flat list of configurations. */
export type ConfigurationsBySection = Record<Section, ConfigurationItem[]>;

/* ── hook ───────────────────────────────────────────────────────────────── */

/**
 * Fetch configurations for all sections in parallel.
 * Returns an object keyed by section name, with each value being the
 * flat list of configurations (no pagination — `pageSize: 200` covers
 * the expected scale).
 */
export function useConfigurationsBySection(projectId: string): {
  data: ConfigurationsBySection | null;
  isLoading: boolean;
} {
  /* Fire one query per section in parallel — top-level useQueries call. */
  const queries = useQueries({
    queries: useMemo(() => {
      const base = {
        projectId,
        includeShared: true,
        pageSize: 200,
      };
      return SECTIONS.map((section) => ({
        queryKey: ['settings', 'configurations', projectId, section],
        queryFn: () =>
          getConfigurationsList({ ...base, section }),
        enabled: !!projectId,
      }));
    }, [projectId]),
  });

  /* Combine results */
  const result = useMemo((): { data: ConfigurationsBySection | null; isLoading: boolean } => {
    const anyFetching = queries.some((q) => q.isFetching);

    const data: ConfigurationsBySection = {} as ConfigurationsBySection;
    SECTIONS.forEach((section, index) => {
      const q = queries[index];
      if (q?.data?.items) {
        data[section] = q.data.items;
      } else {
        data[section] = [];
      }
    });

    // If any query is still fetching, return null data so consumers show
    // loading states rather than partially-loaded sections.
    return {
      data: anyFetching ? null : data,
      isLoading: anyFetching,
    };
  }, [queries]);

  return result;
}
