/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/lib/
 * hooks/useGetToolkitNameFromSchema.hooks.js` (38 lines, unit A2d), plus
 * `features/toolkits/lib/helpers/toolkits.helpers.js:127-134` (`cleanString`)
 * and `:251-267` (`genToolkitName`), which the baseline hook wraps.
 *
 * DISCLOSED REDESIGN: the baseline reads `schemaOfTools` from
 * `useSelector(state => state.applications.toolkitSchemas || {})` --
 * global Redux cache, populated by a separate RTK-Query
 * `onQueryStarted` side effect. This app has no Redux
 * (`react-hook-form` + `zustand`, `package.json`) and R-S1 ("a zustand
 * store may not hold data derivable from a query") forbids re-creating
 * that exact cache shape as a store. The one caller in THIS sub-unit's
 * owned files (`useFunctionInputMapping.ts`) already has its own
 * `toolkitTypes` query result in scope (via a local `useToolkitTypeSchemas`
 * duplicate, `../hooks/useToolkitTypeSchemas.ts`) — so `schemaOfTools`
 * becomes a plain parameter instead of an ambient selector read, matching
 * this batch's established "ambient context -> parameter" convention
 * (`features/agents/model/useCreateApplication.ts`'s "DISCLOSED REDESIGN").
 *
 * `cleanString`/`genToolkitName` are duplicated locally, NOT imported from
 * `features/toolkits` (`no-sideways-features`, and unit A4 has not landed
 * in this worktree regardless) -- this is the SAME situation
 * `features/agents/lib/toolkitLabel.ts` already documents for its own
 * identical duplicate; this mission's own preamble explicitly anticipates
 * A4b needing to duplicate THIS hook the same way.
 */
import { useCallback } from 'react';

import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';

interface GenToolkitNameInput {
  readonly type?: string | undefined;
  readonly name?: string | undefined;
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
}

/** `toolkits.helpers.js:127-134`. Strips everything but alphanumerics, underscore and hyphen, then folds `.` into `_`. */
export function cleanString(value: string | undefined, maxLength = 0): string {
  if (typeof value !== 'string') return '';
  const pattern = /[^a-zA-Z0-9_.-]/g;
  const result = value.replace(pattern, '').replaceAll('.', '_');
  return maxLength > 0 ? result.slice(0, maxLength) : result;
}

/**
 * One schema-`properties` entry — `toolkit_name` flags the settings field
 * that names this toolkit type; `args_schemas` is only ever present on the
 * `selected_tools` entry. Both live on one interface (rather than an
 * intersection keyed by property name) so `Object.entries(...)` iteration
 * keeps a single, precise value type instead of losing it to a union.
 */
interface SchemaProperty {
  readonly toolkit_name?: boolean;
  readonly args_schemas?: Readonly<Record<string, unknown>>;
}

interface ToolkitSchemaShape {
  readonly properties?: Readonly<Record<string, SchemaProperty>>;
  readonly required?: readonly string[];
  readonly name_required?: boolean;
}

/** `name` -> `settings.elitea_title` -> `settings.configuration_title` -> `''`, cleaned. */
function genToolkitNameFallback(tool: GenToolkitNameInput): string {
  return cleanString(
    tool.name ?? (tool.settings?.['elitea_title'] as string | undefined) ?? (tool.settings?.['configuration_title'] as string | undefined) ?? '',
  );
}

/** `toolkits.helpers.js:251-267`. */
export function genToolkitName(tool: GenToolkitNameInput, schemaOfTools: ToolkitTypeSchemaMap | undefined): string {
  const schema = (tool.type !== undefined ? (schemaOfTools?.[tool.type] as ToolkitSchemaShape | undefined) : undefined) ?? {};
  const propertyEntry = Object.entries(schema.properties ?? {}).find(([, value]) => value.toolkit_name);
  const key = propertyEntry?.[0];
  const fallback = genToolkitNameFallback(tool);

  if (key === undefined) return fallback;

  const keyedValue = cleanString(tool.settings?.[key] as string | undefined);
  return keyedValue || fallback;
}

export interface UseGetToolkitNameFromSchemaResult {
  readonly getToolkitNameFromSchema: (toolkit: GenToolkitNameInput) => string;
  readonly getToolkitNamePropFromSchema: (type: string) => string | undefined;
  readonly getRequiredProperties: (type: string) => readonly string[];
  readonly getSelectedTools: (type: string | undefined) => readonly string[];
  readonly isNameRequired: (type: string) => boolean;
}

export function useGetToolkitNameFromSchema(schemaOfTools: ToolkitTypeSchemaMap | undefined): UseGetToolkitNameFromSchemaResult {
  const getToolkitNameFromSchema = useCallback(
    (toolkit: GenToolkitNameInput) => genToolkitName(toolkit, schemaOfTools),
    [schemaOfTools],
  );

  const getToolkitNamePropFromSchema = useCallback(
    (type: string) => {
      const schema = (schemaOfTools?.[type] as ToolkitSchemaShape | undefined) ?? {};
      const [key] = Object.entries(schema.properties ?? {}).find(([, value]) => value.toolkit_name) ?? [];
      return key;
    },
    [schemaOfTools],
  );

  const getRequiredProperties = useCallback(
    (type: string): readonly string[] => {
      const schema = (schemaOfTools?.[type] as ToolkitSchemaShape | undefined) ?? {};
      return schema.required ?? [];
    },
    [schemaOfTools],
  );

  const getSelectedTools = useCallback(
    (type: string | undefined): readonly string[] => {
      const schema = (type !== undefined ? (schemaOfTools?.[type] as ToolkitSchemaShape | undefined) : undefined) ?? {};
      return Object.keys(schema.properties?.selected_tools?.args_schemas ?? {});
    },
    [schemaOfTools],
  );

  const isNameRequired = useCallback(
    (type: string) => (schemaOfTools?.[type] as ToolkitSchemaShape | undefined)?.name_required !== false,
    [schemaOfTools],
  );

  return { getToolkitNameFromSchema, getToolkitNamePropFromSchema, getRequiredProperties, getSelectedTools, isNameRequired };
}
