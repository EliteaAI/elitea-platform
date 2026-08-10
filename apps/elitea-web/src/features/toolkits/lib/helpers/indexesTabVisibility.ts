/**
 * Whether the "Indexes" tab is offered at all, and with which tools —
 * `apps/elitea-ui/src/pages/Toolkits/EditToolkit.jsx`'s own
 * `shouldHideIndexesTab` (lines 205-217) and `selectedIndexTools` (199-203).
 *
 * REGRESSION THIS FIXES (found while wiring #149). The port dropped
 * `shouldHideIndexesTab` entirely and rendered the tab unconditionally, for
 * every toolkit AND every MCP. The baseline's very first branch is
 * `if (mcpId) return true` — on `/mcps/:tab/:mcpId` the tab is given
 * `display: 'none'` (`components/StyledTabs.jsx:241`,
 * `sx={[styles.tab, {display: tab.display}]}`), so an MCP edit screen has NO
 * Indexes tab in the baseline at all. Its second branch hides the tab for
 * any toolkit type whose schema offers no indexing tool. Between them, every
 * screen where the port showed a clickable-but-empty Indexes tab is a screen
 * the baseline never showed one on.
 *
 * DISCLOSED ADAPTATION — where the available tool names are read from. The
 * baseline reads `toolSchema.properties.selected_tools.items.enum`. This
 * backend does not answer that shape: measured against the running stack on
 * 2026-08-09 (`GET /api/v2/elitea_core/toolkits/prompt_lib/1`), every type
 * carries `properties.selected_tools.args_schemas` (an object keyed by tool
 * name) and NONE carries `items.enum`. A byte-faithful port of that
 * expression would therefore hide the tab on every screen, which is the
 * same defect in the other direction. Both shapes are read here — the exact
 * precedent `ui/test-tools/TestToolSettings.tsx:156` already set for the
 * identical lookup ("`args_schemas` keys or `items.enum`").
 *
 * Measured tool availability on that stack: `artifact` and `datasource`
 * offer `index_data`; `application`, `custom`, `database`, `github`, `jira`
 * and `openapi` offer none.
 */
import { IndexesToolsEnum } from '../../indexes/lib/constants/indexDetails.constants';

const INDEX_TOOL_NAMES: readonly string[] = Object.values(IndexesToolsEnum);

interface SelectedToolsSchema {
  readonly args_schemas?: Readonly<Record<string, unknown>> | undefined;
  readonly items?: { readonly enum?: readonly string[] | undefined } | undefined;
}

interface ToolkitTypeSchemaLike {
  readonly properties?: { readonly selected_tools?: SelectedToolsSchema | undefined } | undefined;
}

/** The tool names a toolkit TYPE offers — `args_schemas` keys, or the baseline's `items.enum`. */
function availableToolNames(schema: ToolkitTypeSchemaLike | undefined): readonly string[] {
  const selectedTools = schema?.properties?.selected_tools;
  if (selectedTools === undefined) return [];
  const fromArgsSchemas = Object.keys(selectedTools.args_schemas ?? {});
  if (fromArgsSchemas.length > 0) return fromArgsSchemas;
  return selectedTools.items?.enum ?? [];
}

export interface IndexesTabVisibilityParams {
  /** True on the `/mcps/:tab/:mcpId` route — the baseline's `if (mcpId) return true`. */
  readonly isMCP: boolean;
  /** The schema for the toolkit's OWN type, i.e. `toolkitSchemas[editToolDetail.type]`. */
  readonly toolkitTypeSchema: unknown;
  /** The toolkit instance's saved `settings.selected_tools`. */
  readonly selectedTools: unknown;
}

export interface IndexesTabVisibility {
  /** When true the tab is not rendered at all — no label, no panel. */
  readonly hidden: boolean;
  /**
   * The index tools this toolkit actually has selected. Empty means the tab
   * is offered (the TYPE supports indexing) but nothing can be run yet —
   * the baseline's `disableIndexingReason.needToSelectIndexData`.
   */
  readonly selectedIndexTools: readonly string[];
}

export function resolveIndexesTabVisibility(params: IndexesTabVisibilityParams): IndexesTabVisibility {
  const { isMCP, toolkitTypeSchema, selectedTools } = params;

  const selectedIndexTools = (Array.isArray(selectedTools) ? (selectedTools as readonly unknown[]) : [])
    .filter((tool): tool is string => typeof tool === 'string' && INDEX_TOOL_NAMES.includes(tool));

  if (isMCP) return { hidden: true, selectedIndexTools };

  const schemaTools = availableToolNames(toolkitTypeSchema as ToolkitTypeSchemaLike | undefined);
  const hidden = schemaTools.length === 0 || !schemaTools.some((tool) => INDEX_TOOL_NAMES.includes(tool));

  return { hidden, selectedIndexTools };
}
