import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';
import { useListToolkits } from '@/shared/api/generated/toolkits/toolkits';

/**
 * Local duplicate of `features/apps/api/useToolkitTypeSchemas.ts` (unit F5's
 * Wave-2 partition) — `no-sideways-features` forbids importing it directly.
 * Byte-for-byte the same thin wrapper over the generated `useListToolkits`
 * (GET `/elitea_core/toolkits/prompt_lib/{projectId}` — the toolkit-TYPE
 * settings-schema catalogue despite the name; see the generated file's own
 * `NOTE(W2)` comment). Replaces the baseline's `useGetCurrentToolkitSchemas`
 * (`features/toolkits/lib/hooks` — unit A4 has not landed in this worktree;
 * this hook calls the same underlying generated endpoint directly rather
 * than reaching into A4's ownership, matching that file's own precedent).
 */
export function useToolkitTypeSchemas(projectId: string | undefined): {
  readonly toolkitTypeSchemas: ToolkitTypeSchemaMap | undefined;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly error: unknown;
} {
  const query = useListToolkits(projectId ?? '', { query: { enabled: projectId !== undefined } });
  // `.data.data`'s declared type includes the error-envelope variant — never
  // actually reachable here, since `eliteaFetch` throws instead of resolving
  // with it (mutator.ts's §3.6 unwrap contract).
  const toolkitTypeSchemas = query.data?.data as ToolkitTypeSchemaMap | undefined;

  return {
    toolkitTypeSchemas,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
  };
}
