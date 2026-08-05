/**
 * Local duplicate of `features/apps/api/useToolkitTypeSchemas.ts` (that
 * file's own doc comment: "Replaces the baseline's `useGetCurrentToolkitSchemas`
 * (`features/toolkits/lib/hooks` — that slice, unit A4, has not landed;
 * this hook calls the same underlying generated endpoint directly rather
 * than reaching into A4's ownership)"). Duplicated, not imported:
 * `no-sideways-features` forbids `features/pipelines` reaching into
 * `features/apps` either.
 *
 * Thin wrapper over the generated `useListToolkits` (GET
 * `/elitea_core/toolkits/prompt_lib/{projectId}` — despite the name, the
 * toolkit-TYPE settings-schema catalogue, not a list of instances; see the
 * generated file's own `NOTE(W2)` comment).
 *
 * **Real, disclosed gap this hook does NOT attempt to paper over:** the
 * baseline's `useGetCurrentToolkitSchemas` also refetches on the
 * `mcp_status` socket event (`sioEvents.mcp_status`) when `isMCP` is set.
 * No generated endpoint or socket-driven cache invalidation for that
 * exists here yet — `useFunctionInputMapping.ts`'s own header discloses
 * the follow-on consequence (dynamic MCP tool schemas cannot be kept live
 * this way either).
 */
import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { useListToolkits } from '@/shared/api/generated/toolkits/toolkits';

export interface UseToolkitTypeSchemasResult {
  readonly toolkitTypeSchemas: ToolkitTypeSchemaMap | undefined;
  readonly isFetching: boolean;
  readonly isError: boolean;
}

export function useToolkitTypeSchemas(projectId: string | undefined): UseToolkitTypeSchemasResult {
  const query = useListToolkits(projectId ?? '', { query: { enabled: projectId !== undefined } });
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const toolkitTypeSchemas = query.data?.data as ToolkitTypeSchemaMap | undefined;

  return {
    toolkitTypeSchemas,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
