/**
 * Environment field helpers.
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

const FIELD_LABELS: Record<string, string> = {
  llm_server_url: 'LLM Server URL',
  auth_token: 'Auth Token',
  model_name: 'Model Name',
  llm_model_name: 'LLM Model Name',
  project_id: 'Project ID',
  integration_uid: 'Integration UID',
  verify_ssl: 'Verify SSL',
  display_type: 'Display Type',
  debug: 'Debug',
  default_view_mode: 'Default View Mode',
};

const FIELD_TYPES: Record<string, string> = {
  llm_server_url: 'string',
  auth_token: 'string',
  model_name: 'string',
  llm_model_name: 'string',
  project_id: 'string',
  integration_uid: 'string',
  verify_ssl: 'boolean',
  display_type: 'string',
  debug: 'boolean',
  default_view_mode: 'string',
};

const FIELD_DEFAULTS: Record<string, string | number | boolean> = {
  llm_server_url: '',
  auth_token: '',
  model_name: '',
  llm_model_name: '',
  project_id: '',
  integration_uid: '',
  verify_ssl: false,
  display_type: 'split',
  debug: false,
  default_view_mode: 'split',
};

export function buildFieldDefinition(
  key: string,
  fieldSchema: Record<string, unknown> | undefined,
  schemaConstraints: Record<string, { minimum?: number; maximum?: number }>,
): EnvironmentFieldDefinition {
  const constraints = schemaConstraints[key];
  const defaultValue = FIELD_DEFAULTS[key];
  const type = (FIELD_TYPES[key] ?? 'string') as EnvironmentFieldDefinition['type'];

  // Check schema for override types
  let resolvedType = type;
  if (fieldSchema?.type) {
    const schemaType = (fieldSchema.type as string) ?? '';
    if (schemaType === 'integer' || schemaType === 'number') {
      resolvedType = schemaType;
    } else if (schemaType === 'boolean') {
      resolvedType = 'boolean';
    } else {
      resolvedType = 'string';
    }
  }

  return {
    key,
    label: FIELD_LABELS[key] ?? key,
    type: resolvedType,
    defaultValue,
    minimum: constraints?.minimum,
    maximum: constraints?.maximum,
    tooltip: fieldSchema?.description as string | undefined,
  };
}

export function isNumericType(type: string): boolean {
  return type === 'integer' || type === 'number';
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
