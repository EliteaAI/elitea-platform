/**
 * REST client for the global budget soft-alert config —
 * `GET|PUT /api/v2/admin/gateway/budget-alerts`.
 *
 * Split from `./adminLlmProxyApi` because that module reached the file-length
 * gate, and because this is a different surface: two scalar settings with their
 * own endpoints, not part of the catalogue or status contracts.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapBody } from '@/shared/api/unwrap';

const BUDGET_ALERTS_URL = '/admin/gateway/budget-alerts';

/**
 * The global budget soft-alert config (`GET|PUT /admin/gateway/budget-alerts`).
 *
 * These endpoints have existed since #322 with nothing calling them, so the
 * platform-wide alert threshold has been server-only: settable with curl and
 * invisible everywhere else. It belongs on this section because it governs the
 * same budgets the gateway enforces.
 *
 * `threshold_pct` is the DEFAULT. A project whose `gateway.project_budget` row
 * carries its own `soft_alert_pct` uses that instead, so changing this value
 * does not move every project's alert — which is why the form says so rather
 * than implying a global effect.
 */
export interface BudgetAlertConfig {
  readonly enabled: boolean;
  readonly threshold_pct: number;
}

const budgetAlertKeys = {
  all: ['admin', 'llmProxy', 'budgetAlerts'] as const,
};

/**
 * `GET /admin/gateway/budget-alerts`.
 *
 * `refetchOnWindowFocus` is off, as it is on every other config form in this app
 * (`shared/api/configurationsApi`). The alerts panel seeds its inputs from this
 * query's data, and the app default refetches on focus past a 30 s stale time —
 * so an operator who typed a new threshold, alt-tabbed to check a number, and
 * came back would find their edit silently replaced by the stored value, with
 * nothing on screen saying it had happened.
 */
export function useBudgetAlertConfig(): UseQueryResult<BudgetAlertConfig, Error> {
  return useQuery({
    refetchOnWindowFocus: false,
    queryKey: budgetAlertKeys.all,
    queryFn: async (): Promise<BudgetAlertConfig> => {
      const body = unwrapBody(await eliteaFetch<unknown>(BUDGET_ALERTS_URL)) as
        BudgetAlertConfig | undefined;
      // The server answers with the shipped defaults when no row exists, so an
      // undefined body here is a transport shape problem rather than an
      // unconfigured platform. Defaulting to `enabled: false` would report
      // alerting as OFF on a deployment where it is on.
      if (body === undefined) throw new Error('budget alert config missing from the response');
      return body;
    },
  });
}

/**
 * `PUT /admin/gateway/budget-alerts`.
 *
 * A PARTIAL update: the server leaves an omitted field as it was. Both are sent
 * together here because the form edits both, but the partial shape is why a
 * future control for one of them does not need to know the other's value.
 */
export function useSaveBudgetAlertConfig(): UseMutationResult<void, Error, BudgetAlertConfig> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: BudgetAlertConfig) => {
      await eliteaFetch<unknown>(BUDGET_ALERTS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: budgetAlertKeys.all }),
  });
}
