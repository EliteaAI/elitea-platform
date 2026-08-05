import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { getConfigurationsList } from './configurations';
import type { ConfigurationPageWire, GetConfigurationsListParams } from './configurations';

/**
 * TanStack Query wrapper over `./configurations.ts`'s `getConfigurationsList`
 * — this slice's own copy of `features/credentials/api/useConfigurations.ts`'s
 * `useConfigurationsList` (API-146), for `ToolkitForm.tsx`'s baseline
 * `useGetConfigurationsListQuery` call (`ToolkitForm.jsx:196-199`, driving
 * the `supportsConfiguration`/`shouldShowDisabledConfigFields` checks).
 * Query-key convention matches the credentials unit's own
 * (`['credentials', 'configurations', ...]` there; `['toolkits',
 * 'configurations', ...]` here) since neither slice may share a query
 * client key namespace via import.
 */
const CONFIGURATIONS_QUERY_ROOT = ['toolkits', 'configurations'] as const;

export function useConfigurationsList(
  params: GetConfigurationsListParams,
  options: { enabled?: boolean } = {},
): UseQueryResult<ConfigurationPageWire> {
  return useQuery({
    queryKey: [...CONFIGURATIONS_QUERY_ROOT, 'list', params],
    queryFn: ({ signal }) => getConfigurationsList(params, signal),
    enabled: options.enabled ?? true,
  });
}
