/**
 * REST client for "what models does this platform provider offer?" —
 * `POST /api/v2/admin/gateway/providers/{id}/models`.
 *
 * ## What this replaces
 *
 * Legacy had an admin task, `import_llm_models`, that read LiteLLM's own model
 * table and created a shared model row for every entry it found. Bifrost keeps
 * no such table, so there is nothing to import FROM — but the provider itself
 * still lists its models, and the gateway already speaks those dialects (its
 * connection checkers call exactly those endpoints). The server resolves the
 * stored credential, asks the provider through the gateway, and answers with
 * the ids.
 *
 * ## It is a read, and it is a POST
 *
 * A POST because it is a real, outbound provider round trip performed with a
 * server-held secret — not a cacheable resource — and because the surface it
 * sits on already answers `POST /{id}/check` for the same reason. It is
 * modelled as a QUERY here regardless: the dialog wants one fetch per provider
 * with a pending state and an error state, which is what `useQuery` is, and
 * treating it as a mutation would make "has this been fetched" the component's
 * own bookkeeping.
 *
 * `retry` is OFF. Every attempt costs a real provider call, and this route's
 * own failures — a rejected key, an unreachable endpoint — are answers, not
 * flakes. Retrying them three times would triple the provider traffic of one
 * click and change nothing about the outcome.
 *
 * ## Nothing here writes
 *
 * Reading a catalogue is not adopting it. Each model an operator adopts is
 * created through the platform-model surface (`./adminLlmPlatformModelsApi`),
 * which is the one place that derives a model's section, validates its
 * credential link and runs admission.
 *
 * Not generated: `orval` builds from `v2.yaml`, which does not describe the
 * admin-panel routes.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { eliteaFetch } from '@/shared/api/generated/mutator';
import { unwrapBody } from '@/shared/api/unwrap';

const PROVIDERS_URL = '/admin/gateway/providers';

/** One provider's catalogue, as the server reports it. */
export interface ProviderModelList {
  /** The provider's model ids, in the provider's own order. */
  readonly models: readonly string[];
  readonly total: number;
  /**
   * The listing stopped at the server's cap. Rendered, because a short list
   * otherwise reads as the provider's whole catalogue — and an operator then
   * concludes a model is not offered when it simply was not reached.
   */
  readonly truncated: boolean;
  /** The credential type the ids came from, echoed by the server. */
  readonly type: string;
}

/**
 * Not exported: nothing outside this module invalidates or seeds a provider's
 * catalogue. An export with no importer is what the dead-code gate is for.
 */
const providerModelKeys = {
  /** One provider's catalogue. Scoped by id, so two providers never share a cache entry. */
  forProvider: (id: number) => ['admin', 'llmProxy', 'providers', id, 'models'] as const,
};

function normaliseProviderModels(body: Partial<ProviderModelList> | undefined): ProviderModelList {
  return {
    models: body?.models ?? [],
    total: body?.total ?? 0,
    truncated: body?.truncated ?? false,
    type: body?.type ?? '',
  };
}

/**
 * `POST /admin/gateway/providers/{id}/models`.
 *
 * `id` is `undefined` while no provider is being adopted from, and the query is
 * then disabled — a dialog that is closed must not spend a provider round trip.
 */
export function useAdminLlmProviderModels(
  id: number | undefined,
): UseQueryResult<ProviderModelList, Error> {
  return useQuery({
    // `id ?? -1` is never fetched: `enabled` is false for exactly that case.
    // The key still has to be a stable tuple, because react-query builds it
    // before it reads `enabled`.
    queryKey: providerModelKeys.forProvider(id ?? -1),
    enabled: id !== undefined,
    retry: false,
    // The catalogue is re-read whenever the dialog is opened again: a provider
    // that gained a model since the last look must not be reported from a
    // cache, because the whole point of the screen is to find what is new.
    staleTime: 0,
    queryFn: async (): Promise<ProviderModelList> => {
      const body = unwrapBody(
        await eliteaFetch<unknown>(`${PROVIDERS_URL}/${String(id)}/models`, { method: 'POST' }),
      ) as Partial<ProviderModelList> | undefined;
      return normaliseProviderModels(body);
    },
  });
}
