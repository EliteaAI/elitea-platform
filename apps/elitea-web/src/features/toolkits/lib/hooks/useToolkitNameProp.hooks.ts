/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/hooks/
 * useToolkitNameProp.hooks.js` (25 lines, Wave-2 unit A4b).
 *
 * FORBIDDEN SIDEWAYS IMPORT, resolved per this batch's brief (flagged there
 * explicitly, from both sides — A2d's own `useGetToolkitNameFromSchema.ts`
 * doc comment anticipates this exact file needing the same duplication):
 * the baseline imports `useGetToolkitNameFromSchema` from
 * `features/pipelines/flow-editor/lib/hooks` — `no-sideways-features`
 * forbids `features/toolkits` importing `features/pipelines`, absolute, no
 * carve-out. Only the THREE fields this hook actually reads
 * (`getToolkitNamePropFromSchema`/`isNameRequired`/`getRequiredProperties`)
 * are duplicated below — `getToolkitNameFromSchema`/`getSelectedTools`
 * (the other two members of the baseline's full hook) are NOT needed here
 * and are not duplicated (YAGNI; `../helpers/toolkits.helpers.ts`'s own
 * `genToolkitName` already covers the first one for whichever file in this
 * sub-unit needs it).
 *
 * DISCLOSED REDESIGN (ambient -> parameter): the baseline's
 * `useGetToolkitNameFromSchema` reads `schemaOfTools` from
 * `useSelector(state => state.applications.toolkitSchemas || {})` — this
 * app has no Redux (TanStack Query + zustand) and R-S1 forbids re-creating
 * that cache shape as a store, so `schemaOfTools` becomes an explicit
 * parameter here too — the SAME redesign A2d's `useGetToolkitNameFromSchema.ts`
 * already made for the schema map its own duplicate reads, and consistent
 * with this hook's own return shape (the baseline ALSO returns
 * `schemaOfTools` back to its caller, so threading it in as a parameter
 * changes nothing about what the caller already has to hold onto). A real
 * caller supplies `this slice's own `useGetCurrentToolkitSchemas().toolkitSchemas`.
 */
import { useMemo } from 'react';

import type { ToolkitTypeSchemaMap } from '@/entities/toolkit';

interface ToolkitNamePropertySchema {
  readonly toolkit_name?: boolean;
}

interface ToolkitNameSchemaShape {
  readonly properties?: Readonly<Record<string, ToolkitNamePropertySchema | undefined>>;
  readonly required?: readonly string[];
  readonly name_required?: boolean;
}

function schemaFor(schemaOfTools: ToolkitTypeSchemaMap | undefined, type: string): ToolkitNameSchemaShape {
  return (schemaOfTools?.[type] as ToolkitNameSchemaShape | undefined) ?? {};
}

/** `getToolkitNamePropFromSchema` — the settings-property key flagged `toolkit_name` for `type`, if any. */
function toolkitNamePropFromSchema(schemaOfTools: ToolkitTypeSchemaMap | undefined, type: string): string | undefined {
  const schema = schemaFor(schemaOfTools, type);
  const [key] = Object.entries(schema.properties ?? {}).find(([, value]) => value?.toolkit_name) ?? [];
  return key;
}

export interface UseToolkitNamePropResult {
  readonly toolkitNameProp: string | undefined;
  readonly nameIsRequired: boolean;
  readonly descriptionIsRequired: boolean | undefined;
  readonly schemaOfTools: ToolkitTypeSchemaMap | undefined;
}

/**
 * Resolves, for a given toolkit `type`: which settings property (if any)
 * holds the toolkit's display name, whether a name is required (defaults
 * `true` — `name_required !== false`), and whether `description` is one of
 * the type's required properties.
 */
export function useToolkitNameProp(type: string, schemaOfTools: ToolkitTypeSchemaMap | undefined): UseToolkitNamePropResult {
  const toolkitNameProp = useMemo(() => toolkitNamePropFromSchema(schemaOfTools, type), [schemaOfTools, type]);

  const requiredName = useMemo(() => schemaFor(schemaOfTools, type).name_required !== false, [schemaOfTools, type]);

  const requiredDescription = useMemo(() => schemaFor(schemaOfTools, type).required?.includes('description'), [schemaOfTools, type]);

  return {
    toolkitNameProp,
    nameIsRequired: requiredName,
    descriptionIsRequired: requiredDescription,
    schemaOfTools,
  };
}
