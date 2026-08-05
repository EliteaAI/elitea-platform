import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { useListToolkits } from '@/shared/api/generated/toolkits/toolkits';

/**
 * Thin wrapper over the generated `useListToolkits` (GET
 * `/elitea_core/toolkits/prompt_lib/{projectId}` — despite the name, this
 * is the toolkit-TYPE settings-schema catalogue, not a list of instances;
 * see the generated file's own `NOTE(W2)` comment). Replaces the baseline's
 * `useGetCurrentToolkitSchemas` (`features/toolkits/lib/hooks` — that
 * slice, unit A4, has not landed; this hook calls the same underlying
 * generated endpoint directly rather than reaching into A4's ownership).
 *
 * `query.data` is the enveloped `{data, status, headers}` shape declared by
 * `listToolkitsResponse` — `eliteaFetch` (`shared/api/generated/
 * mutator.ts`) was fixed at the source (2026-07-27) to actually build that
 * envelope rather than resolving with the bare body; this reads through
 * `.data`.
 */
export function useToolkitTypeSchemas(projectId: string | undefined) {
  const query = useListToolkits(projectId ?? '', { query: { enabled: projectId !== undefined } });
  // `.data.data`'s declared type includes the error-envelope variant —
  // never actually reachable here since `eliteaFetch` throws instead of
  // resolving with it (mutator.ts's §3.6 unwrap contract).
  const toolkitTypeSchemas = query.data?.data as ToolkitTypeSchemaMap | undefined;

  return {
    toolkitTypeSchemas,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
