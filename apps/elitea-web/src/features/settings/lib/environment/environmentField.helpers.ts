/**
 * Environment field helpers.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/lib/helpers/
 * environmentField.helpers.js`.
 */

export interface EnvironmentFieldDefinition {
  key: string;
  label: string;
  type: 'string' | 'integer' | 'number' | 'boolean';
  defaultValue?: string | number | boolean | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  tooltip?: string | undefined;
}

/** Fallback labels — used only when the backend schema omits `title`. */
const FIELD_LABELS: Record<string, string> = {
  system_sender_name: 'System Sender Name',
  error_toast_duration: 'Error Toast Duration',
};

/** Fallback types — used only when the backend schema omits `type`. */
const FIELD_TYPES: Record<string, string> = {
  system_sender_name: 'string',
  error_toast_duration: 'integer',
};

function resolveType(type: string | undefined): EnvironmentFieldDefinition['type'] {
  if (type === 'integer' || type === 'number' || type === 'boolean') return type;
  return 'string';
}

/** `fieldSchema.title`, falling back to the local label map, then the raw key. */
function resolveLabel(key: string, fieldSchema: Record<string, unknown> | undefined): string {
  const schemaTitle = fieldSchema?.title as string | undefined;
  return schemaTitle ?? FIELD_LABELS[key] ?? key;
}

/** `fieldSchema.minimum`, falling back to the caller's per-field `defaults`. */
function resolveMinimum(
  fieldSchema: Record<string, unknown> | undefined,
  defaults: { minimum?: number } | undefined,
): number | undefined {
  const schemaMinimum = fieldSchema?.minimum as number | undefined;
  return schemaMinimum ?? defaults?.minimum;
}

/** `fieldSchema.maximum`, falling back to the caller's per-field `defaults`. */
function resolveMaximum(
  fieldSchema: Record<string, unknown> | undefined,
  defaults: { maximum?: number } | undefined,
): number | undefined {
  const schemaMaximum = fieldSchema?.maximum as number | undefined;
  return schemaMaximum ?? defaults?.maximum;
}

/**
 * Build a normalised field definition by merging the backend schema with
 * frontend fallback defaults.
 *
 * `defaultValue` always comes from the backend-provided `fieldSchema.default`
 * (never a local hardcoded map) — matches the old app's
 * `buildFieldDefinition` exactly, so "Restore to default" restores to
 * whatever the server's schema actually declares.
 *
 * `minimum`/`maximum` prefer the backend schema's own values, falling back
 * to `defaults` (the caller's single per-field constraints object, e.g.
 * `ENVIRONMENT_FIELD_DEFAULTS[key]` — already indexed once by the caller;
 * this function must NOT index it again).
 */
export function buildFieldDefinition(
  key: string,
  fieldSchema: Record<string, unknown> | undefined,
  defaults: { minimum?: number; maximum?: number } | undefined,
): EnvironmentFieldDefinition {
  const schemaType = fieldSchema?.type as string | undefined;

  return {
    key,
    label: resolveLabel(key, fieldSchema),
    type: resolveType(schemaType ?? FIELD_TYPES[key]),
    defaultValue: fieldSchema?.default as string | number | boolean | undefined,
    minimum: resolveMinimum(fieldSchema, defaults),
    maximum: resolveMaximum(fieldSchema, defaults),
    tooltip: fieldSchema?.description as string | undefined,
  };
}

export function isNumericType(type: string): boolean {
  return type === 'integer' || type === 'number';
}

/**
 * Coerce a raw (always-string) draft value to the field's declared type
 * before it is persisted or compared against the saved value — mirrors the
 * old app's `parseFieldValue`
 * (`apps/elitea-ui/src/[fsd]/features/settings/lib/helpers/
 * environmentField.helpers.js:1-6`). Without this, numeric/boolean-typed
 * fields would always be persisted as plain strings.
 */
export function parseFieldValue(
  value: string,
  type: EnvironmentFieldDefinition['type'],
): string | number | boolean {
  if (type === 'integer') return parseInt(value, 10);
  if (type === 'number') return parseFloat(value);
  if (type === 'boolean') return value === 'true';
  return String(value ?? '').trim();
}

// ---------------------------------------------------------------------------
// Helper: validate integer (complexity ≤ 5)
// ---------------------------------------------------------------------------

function validateInteger(value: string, field: EnvironmentFieldDefinition): string | null {
  const num = parseInt(value, 10);
  if (isNaN(num)) return 'Value must be an integer';
  if (field.minimum !== undefined && num < field.minimum) return `Value must be >= ${field.minimum}`;
  if (field.maximum !== undefined && num > field.maximum) return `Value must be <= ${field.maximum}`;
  return null;
}

// ---------------------------------------------------------------------------
// Helper: validate number (complexity ≤ 5)
// ---------------------------------------------------------------------------

function validateNumber(value: string, field: EnvironmentFieldDefinition): string | null {
  const num = parseFloat(value);
  if (isNaN(num)) return 'Value must be a number';
  if (field.minimum !== undefined && num < field.minimum) return `Value must be >= ${field.minimum}`;
  if (field.maximum !== undefined && num > field.maximum) return `Value must be <= ${field.maximum}`;
  return null;
}

export function validateFieldValue(
  value: string,
  field: EnvironmentFieldDefinition,
): string | null {
  if (field.type === 'integer') return validateInteger(value, field);
  if (field.type === 'number') return validateNumber(value, field);
  return null;
}
