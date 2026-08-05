/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/helpers/
 * toolCustom.helpers.js` (137 lines, Wave-2 unit A4b). Backs
 * `ToolCustom.jsx`'s settings-form validation (A4d,
 * `features/toolkits/ui/form/ToolCustom.tsx`) — validates a settings object
 * against a JSON-Schema, either directly or via its `metadata.sections`
 * (subsection-required-OR-of-fields) shape.
 *
 * `isNullOrUndefined` maps to `shared/lib/object.ts` (the baseline imported
 * it from `@/common/utils`); everything else is a faithful, dependency-free
 * port.
 */
import { isNullOrUndefined } from '@/shared/lib/object';

/** Not exported: no current caller needs these three apart from `ToolCustomSchema` below (which is exported and consumed by `validationSettings`'s callers). */
interface SchemaSubsection {
  readonly fields?: readonly string[];
}

interface SchemaSection {
  readonly required?: boolean;
  readonly subsections?: readonly SchemaSubsection[];
}

interface SchemaMetadata {
  readonly sections?: Readonly<Record<string, SchemaSection>>;
}

export interface ToolCustomSchema {
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly metadata?: SchemaMetadata;
}

/** Flattens every field named by a REQUIRED section's subsections into one array (one entry per subsection — same shape as the baseline, which pushes each subsection's `fields` ARRAY, not each field individually). */
function getSectionRequiredField(schema: ToolCustomSchema | undefined): readonly (readonly string[])[] {
  const sections = schema?.metadata?.sections;
  const requiredProps: (readonly string[])[] = [];

  if (sections) {
    for (const section of Object.values(sections)) {
      if (section.required) {
        for (const subsection of section.subsections ?? []) {
          requiredProps.push(subsection.fields ?? []);
        }
      }
    }
  }

  return requiredProps;
}

function isFieldValid(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return Boolean(value);
    case 'boolean':
      return value !== undefined;
    case 'integer':
      return !isNullOrUndefined(value) && !(typeof value === 'string' && value === '');
    default:
      return Boolean(value);
  }
}

/** Every `schema.required` field (skipped if the schema declares no `required` array at all — an absent `required` is treated as "always valid") is present and typed-valid on `settings`. Fields with a schema `default` are always considered satisfied. */
function validateSettingsBySchema(settings: Readonly<Record<string, unknown>>, schema: ToolCustomSchema | undefined): boolean {
  if (!schema) return false;

  const { required, properties = {} } = schema;
  if (!required) return true;

  return required.every((fieldName) => {
    const property = (properties[fieldName] ?? {}) as { readonly default?: unknown; readonly type?: string };
    if (property.default !== undefined) return true;
    const type = property.type ?? 'string';
    return isFieldValid(settings[fieldName], type);
  });
}

/** For every REQUIRED metadata section, at least one of its subsections must have every one of its `fields` present (truthy, or exactly `0`) on `settings`. A section with no subsections is vacuously satisfied (mirrors the baseline: `subsections.length &&` short-circuits the failure check). */
function validateSettingsBySchemaSections(settings: Readonly<Record<string, unknown>>, schema: ToolCustomSchema | undefined): boolean {
  if (!schema) return false;

  const sections = schema.metadata?.sections;
  if (sections) {
    for (const section of Object.values(sections)) {
      if (section.required) {
        const subsections = section.subsections ?? [];
        if (subsections.length === 0) continue;
        const hasSatisfiedSubsection = subsections.some((subsection) =>
          (subsection.fields ?? []).reduce<boolean>((acc, field) => acc && (Boolean(settings[field]) || settings[field] === 0), true),
        );
        if (!hasSatisfiedSubsection) return false;
      }
    }
  }

  return true;
}

/**
 * `arr.join(', ')`, with the final element joined by `connector` (default
 * `'and'`) instead of a comma — `arrayToString(['a'])` -> `'a'`,
 * `arrayToString(['a','b'])` -> `'a and b'`, `arrayToString(['a','b','c'])`
 * -> `'a, b and c'`.
 *
 * NOT flattened: `getSectionRequiredField`'s caller passes an array of
 * `fields` arrays (one per required subsection), same as the baseline's own
 * `arrayToString(getSectionRequiredField(schema), 'or')` call site — the
 * baseline's `newArray.join(', ')` stringifies a nested array element via
 * `Array.prototype.join`'s own implicit `String(...)` coercion (e.g.
 * `String(['a','b'])` -> `'a,b'`), so this is ported element-generically
 * (`readonly unknown[]`) rather than flattening, to reproduce that exact
 * (slightly odd, but real) baseline behaviour rather than silently
 * "fixing" it.
 */
function arrayToString(arr: readonly unknown[] | undefined, connector = 'and'): string {
  if (!arr || arr.length === 0) return '';

  const newArray = [...arr];
  const [first] = newArray;
  if (newArray.length === 1) return String(first);

  const lastItem = newArray.pop();
  return `${newArray.join(', ')} ${connector} ${String(lastItem)}`;
}

export type ValidationResult = { readonly isValid: true } | { readonly isValid: false; readonly errorMessage: string };

/**
 * Valid iff (schema validates AND its sections validate) OR a
 * `configurationSchema` (an attached credential/configuration's own schema)
 * validates on its own — the two are alternative satisfaction paths, not
 * both required. `needToCheckSection` (default `true`) can skip the
 * sections check, e.g. for a schema with no section metadata at all.
 */
export function validationSettings(
  settings: Readonly<Record<string, unknown>>,
  schema: ToolCustomSchema | undefined,
  configurationSchema: ToolCustomSchema | undefined,
  needToCheckSection = true,
): ValidationResult {
  const isValidForSchema = validateSettingsBySchema(settings, schema);
  const isValidForSchemaSections = !needToCheckSection || validateSettingsBySchemaSections(settings, schema);
  const isValidForConfigurationSchema = configurationSchema !== undefined && validateSettingsBySchema(settings, configurationSchema);

  if ((isValidForSchema && isValidForSchemaSections) || isValidForConfigurationSchema) {
    return { isValid: true };
  }

  if (configurationSchema !== undefined && settings['configuration_title']) {
    return {
      isValid: false,
      errorMessage: `These settings are required: ${arrayToString(configurationSchema.required)}`,
    };
  }

  const requiredProps =
    !isValidForSchema && schema?.required ? arrayToString(schema.required) : arrayToString(getSectionRequiredField(schema), 'or');

  return {
    isValid: false,
    errorMessage: `These settings are required: ${requiredProps}`,
  };
}
