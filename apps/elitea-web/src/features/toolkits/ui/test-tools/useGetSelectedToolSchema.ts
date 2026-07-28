import { useMemo } from 'react';

import { useGetCurrentToolkitSchemas } from '../../lib/hooks/useGetCurrentToolkitSchemas.hooks';

import type { JsonSchemaLike } from '../../indexes/lib/helpers/indexChat.helpers';

/**
 * Ported from `apps/elitea-ui/src/hooks/toolkit/useGetSelectedToolSchema.js`
 * (44 lines, NOT under `[fsd]/`, not one of the 4 confirmed-not-promoted
 * hooks, not owned by any other A4 sub-unit — `TestTools.jsx` is its only
 * baseline call site, so this sub-unit (A4f) is its rightful owner). Kept
 * local to `ui/test-tools/` (not `lib/hooks/`) for the same reason
 * `features/toolkits/api/useIsMcpVisible.ts` gives for staying feature-local
 * rather than being promoted: single consumer.
 *
 * **REAL BACKEND GAP (new, beyond the three the mission brief already
 * disclosed):** the baseline's third schema-resolution tier reads
 * `useToolkitAvailableToolsQuery({projectId, toolkitId})` (`api/toolkits.js:478-486`,
 * `GET {apiSlicePath}/toolkit_available_tools/prompt_lib/{projectId}/{toolkitId}`)
 * for OpenAPI-like toolkits that expose neither a static
 * `selected_tools.args_schemas` entry nor a pre-loaded MCP `args_schema`.
 * Grepped `shared/api/generated/toolkits/toolkits.ts` in full: it exports
 * exactly `useListToolkits`/`useListToolkitInstances` — no
 * `toolkit_available_tools`-shaped endpoint exists anywhere under
 * `shared/api/generated/**`. This tier is therefore dropped; `toolSchema`
 * resolves from the static/MCP tiers only. `TestToolSettings.tsx`'s own
 * doc comment discloses the identical gap for its sibling use of the same
 * missing endpoint (populating the tool picker's option list, not just
 * schemas) — one real, two call sites, cited once each.
 *
 * `toolkitId`/`projectId` are dropped from this hook's own signature
 * entirely (the baseline threads both through purely to drive the now-gap-
 * blocked dynamic query) rather than kept as accepted-but-unused
 * parameters — an honest narrowing of the port's surface, not a silent
 * behaviour change of what remains.
 */
export interface McpToolOption {
  readonly value?: string | undefined;
  readonly args_schema?: JsonSchemaLike | undefined;
}

export interface UseGetSelectedToolSchemaParams {
  readonly toolkitType: string | undefined;
  readonly toolOptionType: string | null;
  readonly availableMcpTools: readonly McpToolOption[] | undefined;
}

interface SelectedToolsSchemaEntry {
  readonly args_schemas?: Readonly<Record<string, JsonSchemaLike>> | undefined;
}

interface ToolInputSchemaShape {
  readonly inputSchema?: JsonSchemaLike | undefined;
  readonly title?: string | undefined;
  readonly name?: string | undefined;
  readonly description?: string | undefined;
}

function normalizeMcpInputSchema(toolSchema: JsonSchemaLike): JsonSchemaLike {
  const shaped = toolSchema as ToolInputSchemaShape;
  const inputSchema = shaped.inputSchema;
  if (!inputSchema) return toolSchema;

  return {
    properties: inputSchema.properties ?? {},
    required: inputSchema.required ?? [],
    title: shaped.title ?? shaped.name,
    description: shaped.description,
    type: 'object',
  };
}

/** The static-schema-lookup tier, split out of `useGetSelectedToolSchema`'s memo body to stay under the §3.5 complexity budget. */
function resolveStaticToolSchema(toolkitTypeSchema: unknown, toolOptionType: string): JsonSchemaLike | undefined {
  const selectedToolsEntry = (toolkitTypeSchema as { properties?: { selected_tools?: SelectedToolsSchemaEntry } } | undefined)?.properties?.selected_tools;
  return selectedToolsEntry?.args_schemas?.[toolOptionType];
}

/** The whole tool-schema resolution (static tier, then pre-loaded-MCP tier), split out of the hook body to stay under the §3.5 complexity budget. */
function resolveToolSchema(params: UseGetSelectedToolSchemaParams & { readonly toolkitTypeSchema: unknown }): JsonSchemaLike | null {
  const { toolOptionType, availableMcpTools, toolkitTypeSchema } = params;
  if (!toolOptionType || toolkitTypeSchema === undefined) return null;

  const staticToolSchema = resolveStaticToolSchema(toolkitTypeSchema, toolOptionType);
  // MCP tools have schemas pre-loaded in settings (baseline: `availableMcpTools`).
  const mcpToolSchema = availableMcpTools?.find((it) => it.value === toolOptionType)?.args_schema;

  const toolSchema = staticToolSchema ?? mcpToolSchema ?? null;
  return toolSchema ? normalizeMcpInputSchema(toolSchema) : null;
}

export function useGetSelectedToolSchema(params: UseGetSelectedToolSchemaParams): JsonSchemaLike | null {
  const { toolkitType, toolOptionType, availableMcpTools } = params;
  const { toolkitSchemas } = useGetCurrentToolkitSchemas();
  const toolkitTypeSchema = toolkitType !== undefined ? toolkitSchemas?.[toolkitType] : undefined;

  return useMemo(
    () => resolveToolSchema({ toolkitType, toolOptionType, availableMcpTools, toolkitTypeSchema }),
    [toolkitType, toolOptionType, availableMcpTools, toolkitTypeSchema],
  );
}
