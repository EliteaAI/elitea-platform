import { ToolTypes } from './toolForm';
import type { ToolkitTypeSchemaMap } from './types';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useToolMenuItems.jsx`
 * (Wave-2 promotion pass, Part 3). That hook's full surface is Formik-free
 * but still pulls in `@mui/material`'s `useTheme` (for icon colouring),
 * `features/toolkits/lib/hooks` (schema-fetching, features-layer),
 * `common/toolkitUtils`'s `getToolIconByType`, and `JsonIcon` — none of
 * which belong in `entities/` (icon rendering + schema fetching are
 * features-layer concerns, and `entities/` may not import `features/`
 * either way). What IS ported: the pure filtering/labelling/schema-merge
 * decisions the hook made before handing off to icon rendering — the part
 * that is genuinely "toolkit entity" domain logic, not UI.
 */

function metadataOf(schema: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> {
  const metadata = schema?.['metadata'];
  return typeof metadata === 'object' && metadata !== null ? (metadata as Readonly<Record<string, unknown>>) : {};
}

/**
 * The baseline's `isMCP` branch of `toolSchemas`: when the backend's
 * non-MCP schema map has an `mcp`-keyed entry, layer it into the MCP schema
 * map under the `mcp` key with its label overridden to "Remote MCP" (a
 * pre-built "remote MCP toolkit type" entry alongside the user's own
 * discovered MCP servers); otherwise just use `mcpSchemas` as-is.
 */
export function mergeMcpToolkitTypeSchemas(
  toolkitSchemas: ToolkitTypeSchemaMap,
  mcpSchemas: ToolkitTypeSchemaMap,
): ToolkitTypeSchemaMap {
  const mcpKey = Object.keys(toolkitSchemas).find((key) => key.toLowerCase() === 'mcp');
  if (mcpKey === undefined) return mcpSchemas;
  const mcpEntry = toolkitSchemas[mcpKey];
  return {
    ...mcpSchemas,
    mcp: { ...mcpEntry, metadata: { ...metadataOf(mcpEntry), label: 'Remote MCP' } },
  };
}

/** The baseline's non-MCP branch: every toolkit type schema except MCP-shaped ones. */
export function nonMcpToolkitTypeSchemas(toolkitSchemas: ToolkitTypeSchemaMap): ToolkitTypeSchemaMap {
  return Object.fromEntries(
    Object.entries(toolkitSchemas).filter(([key, value]) => {
      const type = value['type'];
      return key.toLowerCase() !== 'mcp' && type !== 'mcp' && !key.toLowerCase().endsWith('mcp');
    }),
  );
}

export interface ToolkitTypeMenuEntry {
  readonly key: string;
  readonly label: string;
}

/**
 * The baseline's `toolkitsItems` filter + `toolMenuItems` label mapping,
 * minus icon/`onClick` (features-layer, see module doc): drops hidden,
 * internal-tool-categorised, and agent/application-labelled entries, keeps
 * only application-type OR non-application-type entries per `isApplication`,
 * and overrides the backend's `metadata.label` with this app's own
 * `ToolTypes[key].label` when one exists.
 */
export function toolkitTypeMenuEntries(
  schemas: ToolkitTypeSchemaMap,
  options: { readonly isApplication?: boolean } = {},
): readonly ToolkitTypeMenuEntry[] {
  const isApplication = options.isApplication ?? false;
  const overrides: Readonly<Record<string, { readonly label: string; readonly value: string }>> = ToolTypes;

  return Object.entries(schemas)
    .filter(([key, value]) => {
      const metadata = metadataOf(value);
      const keyLower = key.toLowerCase();
      const label = typeof metadata['label'] === 'string' ? metadata['label'] : '';
      const labelLower = label.toLowerCase();
      const categories = Array.isArray(metadata['categories']) ? (metadata['categories'] as unknown[]) : [];
      const isInternalTool = categories.includes('internal_tool');
      const isAppType = metadata['application'] === true;
      const shouldInclude = isApplication ? isAppType : !isAppType;

      return (
        metadata['hidden'] !== true &&
        !['agent', 'application'].includes(keyLower) &&
        !['agent', 'application'].includes(labelLower) &&
        !isInternalTool &&
        shouldInclude
      );
    })
    .map(([key, value]) => {
      const metadata = metadataOf(value);
      const backendLabel = typeof metadata['label'] === 'string' ? metadata['label'] : '';
      return { key, label: overrides[key]?.label ?? backendLabel };
    })
    .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
}
