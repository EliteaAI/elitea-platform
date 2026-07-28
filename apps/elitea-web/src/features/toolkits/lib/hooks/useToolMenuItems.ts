import { useMemo } from 'react';

import { ToolTypes, toolkitTypeMenuEntries } from '@/entities/toolkit';
import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';

import { useGetCurrentMCPSchemas } from './useGetCurrentMCPSchemas.hooks';
import { useGetCurrentToolkitSchemas } from './useGetCurrentToolkitSchemas.hooks';

/**
 * Local `features/toolkits`-owned duplicate of `apps/elitea-ui/src/hooks/
 * application/useToolMenuItems.jsx` — unit A4g (`ToolkitTypeSelector.tsx`/
 * `CreateToolkitToolTabBar.tsx`, this unit's own owned files, are the
 * baseline's real callers). The pure filtering/labelling core the baseline
 * hook did BEFORE handing off to icon rendering is already promoted to
 * `entities/toolkit`'s `toolkitTypeMenuEntries` (`../../model/toolMenu.ts`'s
 * own doc comment: "What IS ported: the pure filtering/labelling/schema-
 * merge decisions... icon rendering + schema fetching are features-layer
 * concerns"). This hook supplies the schema fetch and the
 * MCP/non-MCP schema-merge split that entity intentionally left
 * intra-slice-only (`mergeMcpToolkitTypeSchemas`/`nonMcpToolkitTypeSchemas`,
 * `../../../../entities/toolkit/model/toolMenu.ts`, NOT re-exported from
 * `entities/toolkit/index.ts` — §3.5 budget, `useGetCurrentMCPSchemas.
 * hooks.ts`'s own doc comment documents the same "cannot legally reach it"
 * gap for the identical reason) — reimplemented locally below since it is
 * ~10 lines, not worth requesting a budget slot for.
 *
 * DISCLOSED SCOPE REDUCTION: `getToolIconByType`/`JsonIcon` (icon
 * rendering, `@mui/material`'s `useTheme` for icon colouring) are DROPPED,
 * not ported — this hook's `key`/`label`/`onClick` triad is what
 * `ToolkitTypeSelector.tsx`'s `Category.CategorySection` rendering actually
 * needs; a faithful icon port would need `../ui/EntityIcon.tsx`'s/
 * `useToolkitIconKind.hooks.ts`'s icon-resolution rules re-derived for a
 * MENU-item (not entity-detail) context, which is out of this unit's scope
 * to build from scratch.
 */

export interface ToolMenuItem {
  readonly key: string;
  readonly label: string;
  readonly onClick: () => void;
}

export interface UseToolMenuItemsParams {
  readonly onAddTool?: (toolType: string, toolSchemas: ToolkitTypeSchemaMap) => () => void;
  readonly isMCP?: boolean;
  readonly isApplication?: boolean;
}

export interface UseToolMenuItemsResult {
  readonly toolMenuItems: readonly ToolMenuItem[];
  readonly isFetchingToolkitTypes: boolean;
}

function metadataOf(schema: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  const metadata = schema?.['metadata'];
  return typeof metadata === 'object' && metadata !== null ? (metadata as Readonly<Record<string, unknown>>) : {};
}

/** `entities/toolkit`'s `mergeMcpToolkitTypeSchemas`, reimplemented locally — see the module doc comment. */
function mergeMcpSchemas(toolkitSchemas: ToolkitTypeSchemaMap, mcpSchemas: ToolkitTypeSchemaMap): ToolkitTypeSchemaMap {
  const mcpKey = Object.keys(toolkitSchemas).find((key) => key.toLowerCase() === 'mcp');
  if (mcpKey === undefined) return mcpSchemas;
  const mcpEntry = toolkitSchemas[mcpKey];
  return { ...mcpSchemas, mcp: { ...mcpEntry, metadata: { ...metadataOf(mcpEntry), label: 'Remote MCP' } } };
}

/** `entities/toolkit`'s `nonMcpToolkitTypeSchemas`, reimplemented locally — see the module doc comment. */
function nonMcpSchemas(toolkitSchemas: ToolkitTypeSchemaMap): ToolkitTypeSchemaMap {
  return Object.fromEntries(
    Object.entries(toolkitSchemas).filter(([key, value]) => {
      const type = (value as { readonly type?: string }).type;
      return key.toLowerCase() !== 'mcp' && type !== 'mcp' && !key.toLowerCase().endsWith('mcp');
    }),
  );
}

export function useToolMenuItems({ onAddTool, isMCP = false, isApplication = false }: UseToolMenuItemsParams = {}): UseToolMenuItemsResult {
  const { toolkitSchemas, isFetching: isFetchingToolkitTypes } = useGetCurrentToolkitSchemas({ isMCP });
  const { mcpSchemas, isFetching: isFetchingMcpSchemas } = useGetCurrentMCPSchemas({ isMCP });

  const toolSchemas = useMemo(
    () => (isMCP ? mergeMcpSchemas(toolkitSchemas ?? {}, mcpSchemas ?? {}) : nonMcpSchemas(toolkitSchemas ?? {})),
    [isMCP, toolkitSchemas, mcpSchemas],
  );

  const toolMenuItems = useMemo<readonly ToolMenuItem[]>(() => {
    const entries = toolkitTypeMenuEntries(toolSchemas, { isApplication });
    const items: ToolMenuItem[] = entries.map(({ key, label }) => ({ key, label, onClick: onAddTool ? onAddTool(key, toolSchemas) : () => {} }));

    // Don't include "Custom" for applications (baseline: `useToolMenuItems.jsx:88-99`).
    if (!isMCP && !isApplication && !items.some((item) => item.key === ToolTypes.custom.value)) {
      items.push({ key: ToolTypes.custom.value, label: ToolTypes.custom.label, onClick: onAddTool ? onAddTool(ToolTypes.custom.value, toolSchemas) : () => {} });
    }

    return [...items].sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }, [toolSchemas, isApplication, isMCP, onAddTool]);

  return { toolMenuItems, isFetchingToolkitTypes: isMCP ? isFetchingMcpSchemas : isFetchingToolkitTypes };
}
