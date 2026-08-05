/**
 * RTK Query hook for the support assistant config endpoint.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/widgets/support-assistant/api/supportAssistantConfigApi.js`.
 *
 * The old app uses RTK Query (Redux Toolkit) via `eliteaApi` enhancer.
 * The new app uses `@tanstack/react-query` directly with `eliteaFetch`.
 * The shape mirrors the old endpoint: `GET /support_assistant/config/`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import type { SupportAssistantConfig } from '@/shared/api/generated/model';

/* ── query key ──────────────────────────────────────────────────────── */

const SUPPORT_ASSISTANT_CONFIG_KEY = ['supportAssistant', 'config'];

/* ── fetcher ────────────────────────────────────────────────────────── */

async function getSupportAssistantConfig(): Promise<SupportAssistantConfig> {
  const result = await eliteaFetch<SupportAssistantConfig>('/support_assistant/config/');
  return result;
}

/* ── hook ───────────────────────────────────────────────────────────── */

/**
 * Hook that fetches the support assistant configuration.
 *
 * Returns `enabled: boolean` from the server. When the endpoint is not
 * yet wired in the backend, the query fails silently (fallback: disabled).
 */
export function useGetSupportAssistantConfigQuery(
  options?: { enabled?: boolean },
): UseQueryResult<SupportAssistantConfig, Error> {
  return useQuery<SupportAssistantConfig, Error>({
    queryKey: SUPPORT_ASSISTANT_CONFIG_KEY,
    queryFn: getSupportAssistantConfig,
    enabled: options?.enabled ?? true,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false, // Don't retry on failure — it's a binary on/off flag
  });
}
