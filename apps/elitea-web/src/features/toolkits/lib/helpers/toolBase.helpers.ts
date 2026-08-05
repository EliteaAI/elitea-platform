/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/
 * helpers/toolBase.helpers.js` (134 lines, Wave-2 unit A4b). Pure JSON-Schema
 * field helpers backing `ToolBase.jsx`'s settings-form renderer (A4d,
 * `features/toolkits/ui/form/ToolBase/ToolBase.tsx`) — no external
 * dependencies in the baseline.
 */

/** A property's `anyOf`/`oneOf` sub-schema (only the fields these helpers read). Not exported: no current caller needs it apart from `JsonSchemaProperty` below. */
interface JsonSchemaPropertyBranch {
  readonly type?: string;
  readonly format?: string;
  readonly secret?: boolean;
  readonly exclusiveMinimum?: number;
  readonly minimum?: number;
  readonly exclusiveMaximum?: number;
  readonly maximum?: number;
}

export interface JsonSchemaProperty extends JsonSchemaPropertyBranch {
  readonly anyOf?: readonly JsonSchemaPropertyBranch[];
  readonly oneOf?: readonly JsonSchemaPropertyBranch[];
}

/**
 * True when a field should render as a password/secret input: a top-level
 * `format === 'password'` or truthy `secret`, OR (when `fullSchema` is
 * given) any `anyOf`/`oneOf` branch carrying either.
 */
export function isSecretField(
  // Kept for baseline call-site signature parity: `isSecretField.js`'s own
  // `key` param is unused too (callers pass the field key without a
  // separate arity check) — `_`-prefixed so `noUnusedParameters` allows it.
  _key: string,
  format: string | undefined,
  secret: boolean | undefined,
  fullSchema: JsonSchemaProperty | null = null,
): boolean {
  if (format === 'password' || Boolean(secret)) {
    return true;
  }

  const branches = fullSchema?.anyOf ?? fullSchema?.oneOf;
  if (branches !== undefined) {
    const hasPasswordFormat = branches.some((schema) => schema.format === 'password' || Boolean(schema.secret));
    if (hasPasswordFormat) return true;
  }

  return false;
}

const SPECIAL_LABEL_MAP: Readonly<Record<string, string>> = {
  'cache ttl': 'Cache TTL',
};

/** `snake_case`/space-separated field name -> Title Case label, with a small irregular-casing override table (e.g. `"cache ttl"` -> `"Cache TTL"`, not `"Cache Ttl"`). */
export function adjustLabel(label: string): string {
  const override = SPECIAL_LABEL_MAP[label.toLowerCase()];
  if (override !== undefined) return override;
  return label
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export interface IntegerConstraints {
  readonly exclusiveMinimum?: number;
  readonly minimum?: number;
  readonly exclusiveMaximum?: number;
  readonly maximum?: number;
}

/** Mutable working shape for `getIntegerConstraints`'s two-source (top-level + `anyOf` branch) merge. */
interface MutableIntegerBounds {
  exclusiveMinimum: number | undefined;
  minimum: number | undefined;
  exclusiveMaximum: number | undefined;
  maximum: number | undefined;
}

/** The `anyOf`-fallback merge half of `getIntegerConstraints`, split out to stay under the §3.5 complexity budget. */
function mergeIntegerBranchBounds(bounds: MutableIntegerBounds, propertySchema: JsonSchemaProperty): MutableIntegerBounds {
  const integerBranch = propertySchema.anyOf?.find((item) => item.type === 'integer');
  if (integerBranch === undefined) return bounds;

  return {
    exclusiveMinimum: bounds.exclusiveMinimum ?? integerBranch.exclusiveMinimum,
    minimum: bounds.minimum ?? integerBranch.minimum,
    exclusiveMaximum: bounds.exclusiveMaximum ?? integerBranch.exclusiveMaximum,
    maximum: bounds.maximum ?? integerBranch.maximum,
  };
}

/**
 * `exactOptionalPropertyTypes` requires the conditional-spread pattern
 * (matching `entities/application-form/lib/normalise.ts`'s convention) — an
 * absent source field must produce an ABSENT target key, never a present
 * key holding `undefined`. Returns `null` when every bound is absent.
 */
function toIntegerConstraints(bounds: MutableIntegerBounds): IntegerConstraints | null {
  const { exclusiveMinimum, minimum, exclusiveMaximum, maximum } = bounds;
  const hasConstraints = exclusiveMinimum !== undefined || minimum !== undefined || exclusiveMaximum !== undefined || maximum !== undefined;
  if (!hasConstraints) return null;

  return {
    ...(exclusiveMinimum !== undefined ? { exclusiveMinimum } : {}),
    ...(minimum !== undefined ? { minimum } : {}),
    ...(exclusiveMaximum !== undefined ? { exclusiveMaximum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
  };
}

/**
 * Extracts integer bounds from a property schema, checking both the
 * top-level fields and (as a fallback per-field) an `anyOf` integer branch
 * (the `Optional[int]` JSON-Schema shape: `anyOf: [{type: 'integer', ...}, {type: 'null'}]`).
 * Returns `null` when no bound is present anywhere.
 */
export function getIntegerConstraints(propertySchema: JsonSchemaProperty | undefined): IntegerConstraints | null {
  if (!propertySchema) return null;

  const topLevelBounds: MutableIntegerBounds = {
    exclusiveMinimum: propertySchema.exclusiveMinimum,
    minimum: propertySchema.minimum,
    exclusiveMaximum: propertySchema.exclusiveMaximum,
    maximum: propertySchema.maximum,
  };

  return toIntegerConstraints(mergeIntegerBranchBounds(topLevelBounds, propertySchema));
}

/** Stringifies an integer-field's raw value for `parseInt` — only ever called with a primitive (string/number/boolean) form value, never an object, so the default `[object Object]` stringification is unreachable, not silently wrong. */
function toParseableString(value: string | number | boolean): string {
  return typeof value === 'string' ? value : String(value);
}

/** The bound-check half of `validateIntegerConstraints`, split out to stay under the §3.5 complexity budget. */
function checkIntegerBounds(numValue: number, constraints: IntegerConstraints): string | false {
  const { exclusiveMinimum, minimum, exclusiveMaximum, maximum } = constraints;

  if (exclusiveMinimum !== undefined && numValue <= exclusiveMinimum) {
    return `Value must be greater than ${exclusiveMinimum}`;
  }
  if (minimum !== undefined && numValue < minimum) {
    return `Value must be at least ${minimum}`;
  }
  if (exclusiveMaximum !== undefined && numValue >= exclusiveMaximum) {
    return `Value must be less than ${exclusiveMaximum}`;
  }
  if (maximum !== undefined && numValue > maximum) {
    return `Value must be at most ${maximum}`;
  }

  return false;
}

/**
 * Validates a (possibly string-typed form-field) value against integer
 * `constraints`. Returns an error message string, or `false` when valid.
 * An empty/`null`/`undefined` value is only an error when a minimum bound
 * is declared (mirrors the baseline: a field with no minimum is allowed to
 * be blank here — required-ness is `validateRequiredFields`'s job, not
 * this function's).
 */
export function validateIntegerConstraints(
  value: string | number | boolean | null | undefined,
  constraints: IntegerConstraints | null,
): string | false {
  if (!constraints) return false;

  if (value === undefined || value === null || value === '') {
    if (constraints.exclusiveMinimum !== undefined || constraints.minimum !== undefined) {
      return 'Field is required';
    }
    return false;
  }

  const numValue = typeof value === 'number' ? value : parseInt(toParseableString(value), 10);
  if (Number.isNaN(numValue)) {
    return 'Field is required';
  }

  return checkIntegerBounds(numValue, constraints);
}

/** True for `type: 'integer'` directly, or an `anyOf` branch typed `'integer'` (the `Optional[int]` shape). */
export function isIntegerType(propertySchema: JsonSchemaProperty | undefined): boolean {
  if (!propertySchema) return false;
  return propertySchema.type === 'integer' || (propertySchema.anyOf?.some((item) => item.type === 'integer') ?? false);
}

export interface RequiredFieldsSchema {
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchemaProperty | undefined>>;
}

/**
 * Builds a `{fieldName: hasError}` map for every `schema.required` field
 * that isn't `elitea_title` (unless `enableEditEliteaTitle`) and isn't
 * already covered by `sectionProps` (fields owned by a metadata section,
 * validated separately). A boolean property, or one with no schema entry,
 * is never flagged as missing (mirrors the baseline: `!propSchema ||
 * propSchema.type === 'boolean'` short-circuits to `false`).
 */
export function validateRequiredFields(
  schema: RequiredFieldsSchema | undefined,
  settings: Readonly<Record<string, unknown>>,
  sectionProps: readonly string[] = [],
  enableEditEliteaTitle = false,
): Record<string, boolean> {
  const errors: Record<string, boolean> = {};

  const requiredFields = (schema?.required ?? []).filter(
    (prop) => (enableEditEliteaTitle || prop !== 'elitea_title') && !sectionProps.includes(prop),
  );

  for (const prop of requiredFields) {
    const propSchema = schema?.properties?.[prop];
    if (propSchema === undefined || propSchema.type === 'boolean') {
      errors[prop] = false;
    } else {
      errors[prop] = !settings[prop];
    }
  }

  return errors;
}
