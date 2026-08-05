import { useMemo } from 'react';

import { ToolTypes, toolkitTypeMenuEntries } from '@/entities/toolkit';
import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';

import { getToolkitIcon } from '../helpers/toolkits.helpers';
import type { ToolkitIconInfo } from '../helpers/toolkits.helpers';

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
 * DISCLOSED SCOPE REDUCTION (R6 fix — partial): `getToolIconByType`
 * (`common/toolkitUtils.jsx`, ~30 per-brand SVG icon components) is still
 * DROPPED, not ported — this app has no per-brand toolkit-icon asset
 * library anywhere (grepped `shared/ui/icons/`: partial brand coverage
 * only), the SAME real, disclosed, app-wide gap `../helpers/
 * toolkits.helpers.ts`'s own module doc comment (point 4) and
 * `../ui/EntityIcon.tsx`'s doc comment already document — restoring genuine
 * per-brand icon fidelity needs new icon components under `shared/ui/
 * icons/`, well outside this hook's (or this unit's) scope. What this hook
 * DOES now restore is icon information itself: each entry carries an
 * `iconKind` — the SAME semantic-category substitution
 * `useToolkitIconKind.hooks.ts` and `../helpers/toolkits.helpers.ts`'s own
 * `getToolkitIcon` already established for this exact gap ("drop the
 * decorative fanciness, keep the function") — computed via that very
 * function, rather than the previous key/label/onClick-only triad that
 * dropped icon information entirely. A `ui/`-layer caller maps `iconKind`
 * to whatever generic icon component is available (matching `EntityIcon.tsx`'s
 * own `EntityTypeFallbackIcon`).
 */

interface ToolMenuItem {
  readonly key: string;
  readonly label: string;
  readonly iconKind: ToolkitIconInfo['iconKind'];
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
    const items: ToolMenuItem[] = entries.map(({ key, label }) => ({
      key,
      label,
      iconKind: getToolkitIcon({ type: key }, toolSchemas, isMCP).iconKind,
      onClick: onAddTool ? onAddTool(key, toolSchemas) : () => {},
    }));

    // Don't include "Custom" for applications (baseline: `useToolMenuItems.jsx:88-99`).
    if (!isMCP && !isApplication && !items.some((item) => item.key === ToolTypes.custom.value)) {
      items.push({
        key: ToolTypes.custom.value,
        label: ToolTypes.custom.label,
        iconKind: 'toolkit',
        onClick: onAddTool ? onAddTool(ToolTypes.custom.value, toolSchemas) : () => {},
      });
    }

    return [...items].sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
  }, [toolSchemas, isApplication, isMCP, onAddTool]);

  return { toolMenuItems, isFetchingToolkitTypes: isMCP ? isFetchingMcpSchemas : isFetchingToolkitTypes };
}
