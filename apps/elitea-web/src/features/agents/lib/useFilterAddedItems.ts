import { useMemo } from 'react';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useFilterAddedItems.js`
 * (Wave-2 unit A1e).
 *
 * **DEVIATION FROM BASELINE (disclosed):** the baseline reads
 * `values.version_details.tools` via `useFormikContext()`. This app uses
 * react-hook-form (§2.3), not Formik, and — matching this codebase's
 * established convention for exactly this situation (see
 * `features/mcps/ui/McpAuthStatusBadge.tsx`'s own "DEVIATION FROM
 * BASELINE" doc comment) — `features/` components/hooks should not assume
 * a specific form library is mounted above them. `tools` is therefore a
 * required parameter instead: the caller (a create/edit agent-or-pipeline
 * form, out of this unit's scope) passes its current `version_details.tools`
 * field value down, the same way it would pass any other controlled value.
 *
 * A tool entry shaped enough to be filtered — the subset of
 * `VersionToolRef` (`shared/api/generated/model/versionToolRef.zod.ts`)
 * this hook actually reads, kept structural (not importing the generated
 * type by name) so it also accepts the richer, not-yet-saved local tool
 * shape `useAgentPipelineAssociation`/library-toolkit attachment produce
 * client-side before a save round-trip.
 */
export interface FilterableToolRef {
  readonly id?: string | number | undefined;
  readonly type?: string | undefined;
  readonly settings?: { readonly application_id?: string | number | undefined } | undefined;
}

/** A menu entry addressable by a plain `toolkitId` field (the baseline's `filterToolkits` input shape). */
export interface FilterableToolkitMenuItem {
  readonly toolkitId?: string | number | undefined;
}

/** A menu entry addressable by a nested `data.id` field (the baseline's `filterAgents`/`filterPipelines` input shape). */
export interface FilterableEntityMenuItem {
  readonly data?: { readonly id?: string | number | undefined } | undefined;
}

/** Extracts the IDs of already-added REGULAR toolkits (any tool whose `type` isn't `'agent'`/`'pipeline'` — matches the baseline's literal check byte-for-byte, even though real agent/pipeline tools use `type: 'application'`, not those two literals). */
export function addedToolkitIds(tools: readonly FilterableToolRef[]): ReadonlySet<string | number> {
  return new Set(
    tools
      .filter((tool) => tool.type !== 'agent' && tool.type !== 'pipeline')
      .map((tool) => tool.id)
      .filter((id): id is string | number => id !== undefined && id !== null && id !== ''),
  );
}

/** Extracts the IDs of already-added agents/pipelines — both use `type: 'application'` with the referenced application's id under `settings.application_id`. */
export function addedApplicationToolIds(tools: readonly FilterableToolRef[]): ReadonlySet<string | number> {
  return new Set(
    tools
      .filter((tool) => tool.type === 'application')
      .map((tool) => tool.settings?.application_id)
      .filter((id): id is string | number => id !== undefined && id !== null && id !== ''),
  );
}

export function filterToolkitMenuItems<T extends FilterableToolkitMenuItem>(
  toolkits: readonly T[] | undefined,
  added: ReadonlySet<string | number>,
): readonly T[] {
  if (!toolkits) return [];
  return toolkits.filter((toolkit) => toolkit.toolkitId === undefined || !added.has(toolkit.toolkitId));
}

export function filterEntityMenuItems<T extends FilterableEntityMenuItem>(
  items: readonly T[] | undefined,
  added: ReadonlySet<string | number>,
): readonly T[] {
  if (!items) return [];
  return items.filter((item) => item.data?.id === undefined || !added.has(item.data.id));
}

export interface UseFilterAddedItemsResult {
  readonly filterToolkits: <T extends FilterableToolkitMenuItem>(toolkits: readonly T[] | undefined) => readonly T[];
  readonly filterAgents: <T extends FilterableEntityMenuItem>(agents: readonly T[] | undefined) => readonly T[];
  readonly filterPipelines: <T extends FilterableEntityMenuItem>(pipelines: readonly T[] | undefined) => readonly T[];
  readonly addedToolkitIds: ReadonlySet<string | number>;
  readonly addedAgentIds: ReadonlySet<string | number>;
  readonly addedPipelineIds: ReadonlySet<string | number>;
}

/**
 * Custom hook to filter out already-added items from dropdown menus. This
 * prevents duplicates by excluding items that are already associated with
 * the application. `addedAgentIds`/`addedPipelineIds` are the SAME set as
 * the baseline (both agents and pipelines are `type: 'application'` tools,
 * distinguishable only by the referenced application's own `agent_type`,
 * which this tool-ref shape doesn't carry) — kept as two identically-valued
 * fields anyway, matching the baseline's own duplication, so a caller can
 * name whichever one reads more clearly at the call site.
 */
export function useFilterAddedItems(tools: readonly FilterableToolRef[] | undefined): UseFilterAddedItemsResult {
  const currentTools = useMemo(() => tools ?? [], [tools]);

  const toolkitIds = useMemo(() => addedToolkitIds(currentTools), [currentTools]);
  const applicationToolIds = useMemo(() => addedApplicationToolIds(currentTools), [currentTools]);

  const filterToolkits = useMemo(
    () =>
      <T extends FilterableToolkitMenuItem>(toolkits: readonly T[] | undefined): readonly T[] =>
        filterToolkitMenuItems(toolkits, toolkitIds),
    [toolkitIds],
  );
  const filterAgents = useMemo(
    () =>
      <T extends FilterableEntityMenuItem>(agents: readonly T[] | undefined): readonly T[] =>
        filterEntityMenuItems(agents, applicationToolIds),
    [applicationToolIds],
  );
  const filterPipelines = useMemo(
    () =>
      <T extends FilterableEntityMenuItem>(pipelines: readonly T[] | undefined): readonly T[] =>
        filterEntityMenuItems(pipelines, applicationToolIds),
    [applicationToolIds],
  );

  return {
    filterToolkits,
    filterAgents,
    filterPipelines,
    addedToolkitIds: toolkitIds,
    addedAgentIds: applicationToolIds,
    addedPipelineIds: applicationToolIds,
  };
}
