import { isNullOrUndefined } from '@/shared/lib/object';

import type { ToolSectionSubsection, ToolSectionVisibility } from './ToolSection.types';
import type { ToolPropertySchema } from './types';

/**
 * `ToolSection.tsx`'s pure, non-JSX helper functions — split out to stay
 * under the §3.5 400-line file budget. A file-organization change only, no
 * behaviour change.
 *
 * `isNullOrUndefined` reuses `@/shared/lib/object` (the same helper
 * `ui/form/ToolCustom.tsx`/`lib/helpers/toolCustom.helpers.ts` already
 * import) rather than redeclaring the baseline's local `isNullOrUndefined`
 * (`common/utils.js`) a second time in this slice.
 */
export function capitalizeFirstChar(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function isBooleanFieldSchema(propertySchema: ToolPropertySchema): boolean {
  return propertySchema.type === 'boolean' || Boolean(propertySchema.anyOf?.some((item) => item.type === 'boolean'));
}

/** Field-key -> property-schema pairs for one subsection's `fields`, in `Object.entries(schema.properties)` order — mirrors the baseline's `sectionProps` derivation. */
export function resolveSectionEntries(
  fields: readonly string[],
  properties: Readonly<Record<string, ToolPropertySchema | undefined>>,
  showOnlyConfigurationFields: boolean,
): ReadonlyArray<readonly [string, ToolPropertySchema]> {
  const filtered = showOnlyConfigurationFields ? fields.filter((field) => properties[field]?.configuration === true) : fields;

  const entries: Array<readonly [string, ToolPropertySchema]> = [];
  for (const field of filtered) {
    const schema = properties[field];
    if (schema) entries.push([field, schema]);
  }
  return entries;
}

function isSecretPropertySchema(schema: ToolPropertySchema): boolean {
  return Boolean(schema.secret) || schema.format === 'password';
}

/** Secret fields first, then alphabetical — the baseline's `sectionProps` sort comparator. */
export function compareSectionProps(entryA: readonly [string, ToolPropertySchema], entryB: readonly [string, ToolPropertySchema]): number {
  const [keyA, schemaA] = entryA;
  const [keyB, schemaB] = entryB;
  const secretA = isSecretPropertySchema(schemaA);
  const secretB = isSecretPropertySchema(schemaB);
  if (secretA && !secretB) return -1;
  if (!secretA && secretB) return 1;
  return keyA.localeCompare(keyB);
}

/** The best-matching default subsection: whichever has the most already-set field values. Ported from `ToolSection.jsx:59-72`. */
export function resolveDefaultSubsection(subsections: readonly ToolSectionSubsection[], settings: Readonly<Record<string, unknown>>): ToolSectionSubsection | undefined {
  let best: ToolSectionSubsection | undefined;
  let bestCount = 0;
  for (const subsection of subsections) {
    const count = (subsection.fields ?? []).filter((field) => !isNullOrUndefined(settings[field])).length;
    if (count > bestCount) {
      bestCount = count;
      best = subsection;
    }
  }
  return best;
}

/** Snapshots the currently-selected subsection's set field values, for later restoration — the first half of `onChangeOption` (`ToolSection.jsx:140-158`). */
export function snapshotSubsectionValues(subsections: readonly ToolSectionSubsection[], selectedOption: string, settings: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const currentSubsection = subsections.find((subsection) => subsection.name === selectedOption);
  if (!currentSubsection || selectedOption === 'none') return {};
  const snapshot: Record<string, unknown> = {};
  for (const field of currentSubsection.fields ?? []) {
    const value = settings[field];
    if (value !== null && value !== undefined) snapshot[field] = value;
  }
  return snapshot;
}

/** Every field owned by a subsection OTHER than `newOption`, nulled out — the second half of `onChangeOption` (`ToolSection.jsx:161-167`). */
export function collectUnselectedFields(subsections: readonly ToolSectionSubsection[], newOption: string): Record<string, null> {
  const unselectedSettings: Record<string, null> = {};
  for (const subsection of subsections) {
    if (subsection.name === newOption) continue;
    for (const field of subsection.fields ?? []) unselectedSettings[field] = null;
  }
  return unselectedSettings;
}

export interface ResolvedSectionVisibility {
  readonly showOnlyConfigurationFields: boolean;
  readonly disableConfigFields: boolean;
  readonly checkboxAsteriskRequired: boolean;
}

/** `visibility`'s destructuring defaults, split into their own function — each default value is its own complexity branch, and `ToolSection` is already at the §3.5 budget without them. */
export function resolveSectionVisibility(visibility: ToolSectionVisibility | undefined): ResolvedSectionVisibility {
  const { showOnlyConfigurationFields = false, disableConfigFields = false, checkboxAsteriskRequired = true } = visibility ?? {};
  return { showOnlyConfigurationFields, disableConfigFields, checkboxAsteriskRequired };
}

/** The required-fields validation effect's body (`ToolSection.jsx:201-215`). */
export function computeSectionRequiredErrors(
  fields: readonly string[],
  properties: Readonly<Record<string, ToolPropertySchema | undefined>>,
  settings: Readonly<Record<string, unknown>>,
  notSelectedFields: readonly string[],
): Record<string, boolean> {
  const requiredPropertiesError: Record<string, boolean> = {};
  for (const field of fields) {
    const propertySchema = properties[field];
    const isBooleanField = propertySchema ? isBooleanFieldSchema(propertySchema) : false;
    requiredPropertiesError[field] = isBooleanField ? false : !settings[field];
  }
  for (const field of notSelectedFields) requiredPropertiesError[field] = false;
  return requiredPropertiesError;
}

export type SectionPropEntries = ReadonlyArray<readonly [string, ToolPropertySchema]>;

function hasSetValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** Config-marked fields WITH a set value, plus every regular (non-config) field — the baseline's `fieldsToShow` (`ToolSection.jsx:225-231`), used both for the `disableConfigFields` empty-section gate and `DisabledAuthSection`'s own field list. */
export function resolveFieldsToShowWhenDisabled(sectionProps: SectionPropEntries, settings: Readonly<Record<string, unknown>>): SectionPropEntries {
  const configFields = sectionProps.filter(([, propertySchema]) => propertySchema.configuration === true);
  const regularFields = sectionProps.filter(([, propertySchema]) => propertySchema.configuration !== true);
  const configFieldsWithValues = configFields.filter(([key]) => hasSetValue(settings[key]));
  return [...configFieldsWithValues, ...regularFields];
}

export function resolveSectionFieldRequired(propertySchema: ToolPropertySchema, required: boolean, showOnlyConfigurationFields: boolean, checkboxAsteriskRequired: boolean): boolean {
  if (showOnlyConfigurationFields) return false;
  const isBooleanField = isBooleanFieldSchema(propertySchema);
  return required && !(isBooleanField && !checkboxAsteriskRequired);
}
