import { useMemo } from 'react';

import { useListToolkitInstances } from '@/shared/api/generated/toolkits/toolkits';
import type { ToolkitInstance } from '@/shared/api/generated/model';

/**
 * Page-local duplicate of `features/toolkits/api/toolkits.ts`'s
 * `useToolkitDetail`/`useToolkitsList` (same `GET /elitea_core/tools/
 * prompt_lib/{projectId}` real endpoint, same "no GET-single endpoint
 * exists — find the row inside the real list client-side" derivation — see
 * that file's own module doc comment for the full, exhaustively-verified
 * backend-gap inventory).
 *
 * NOT an import of that hook: `no-deep-slice-import` forbids `pages/`
 * reaching a `features/` slice's internals directly, and `features/
 * toolkits`' public `index.ts` does not export `useToolkitDetail` — its own
 * budget is already at the §3.5 20-symbol ceiling with the four pieces
 * `pages/toolkits/CreateToolkit.tsx`/`EditToolkit.tsx` need more (`ToolkitForm`/
 * `ToolkitTypeSelector`/`CreateToolkitToolTabBar`/`ConfigurationTab` — see
 * `features/toolkits/index.ts`'s own doc comment). `MAX_DETAIL_LOOKUP_PAGE_SIZE`
 * carries the identical "pragmatic single-page fetch, not real pagination"
 * caveat that file's own doc comment discloses.
 */
const MAX_DETAIL_LOOKUP_PAGE_SIZE = 200;

export interface UseToolkitDetailResult {
  readonly detail: ToolkitInstance | undefined;
  readonly isFetching: boolean;
  readonly isError: boolean;
}

export function useToolkitDetail(projectId: string | undefined, toolkitId: string | undefined): UseToolkitDetailResult {
  const query = useListToolkitInstances(
    projectId ?? '',
    { limit: MAX_DETAIL_LOOKUP_PAGE_SIZE, offset: 0 },
    { query: { enabled: projectId !== undefined && toolkitId !== undefined } },
  );
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const data = query.data?.data as { readonly rows: readonly ToolkitInstance[]; readonly total: number } | undefined;
  const detail = useMemo(() => data?.rows.find((row) => row.id === toolkitId), [data, toolkitId]);

  return { detail, isFetching: query.isFetching, isError: query.isError };
}
