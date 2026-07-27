/**
 * lib/schemaField.ts — classifies one `ConfigSchemaNode` property into a
 * form-widget kind, and computes its initial value (unit A7).
 *
 * DISCLOSED SIMPLIFICATION: the baseline's per-type credential form is
 * rendered by the toolkits domain's generic JSON-schema form machinery
 * (`features/toolkits/ui/form/ToolBase/**`, `common/getToolInitialValueBySchema.js`,
 * `ToolBaseHelpers.isSecretField`) — all in the toolkits slice (unit A4),
 * out of this unit's ownership fence (R-L1: sibling `features/*` slices do
 * not import each other; `features/credentials` may not reach into
 * `features/toolkits`). This file is a NEW, narrower, credentials-scoped
 * reimplementation covering the field kinds this domain's credential
 * "data" schemas actually use (string/secret/boolean/number/enum) — not a
 * port of A4's full recursive object/array-field renderer. A credential
 * type whose schema needs nested objects or arrays will render those
 * sub-properties as a best-effort flat string field rather than the
 * baseline's dedicated `CommonObjectField`/`CommonArrayField` widgets.
 */
import type { ConfigSchemaNode } from '../api/configurations';

export type SchemaFieldKind = 'secret' | 'boolean' | 'number' | 'enum' | 'string';

const SECRET_NAME_RE = /password|secret|token|api_key|apikey|private_key|access_key/i;

/**
 * A field is secret-shaped when the schema says so explicitly
 * (`format: 'password'` or `secret: true` — both real markers this
 * domain's schemas use, per `credentialIcon.helpers.js`'s sibling reads of
 * `config_schema`), OR its property key matches a common secret-naming
 * convention. This is the local stand-in for the toolkits domain's
 * `ToolBaseHelpers.isSecretField` (see this module's doc comment).
 */
export function isLikelySecretField(key: string, property: ConfigSchemaNode | undefined): boolean {
  if (property?.format === 'password') return true;
  if (property?.secret === true) return true;
  return SECRET_NAME_RE.test(key);
}

export function classifySchemaField(key: string, property: ConfigSchemaNode | undefined): SchemaFieldKind {
  if (isLikelySecretField(key, property)) return 'secret';
  if (property?.type === 'boolean') return 'boolean';
  if (property?.type === 'number' || property?.type === 'integer') return 'number';
  if (Array.isArray(property?.enum) && property.enum.length > 0) return 'enum';
  return 'string';
}

/**
 * Best-effort port of `getToolInitialValueBySchema`'s per-property default
 * resolution: the schema's own `default`, else a type-appropriate empty
 * value.
 */
export function initialValueForSchemaField(property: ConfigSchemaNode | undefined): unknown {
  if (property?.default !== undefined) return property.default;
  if (property?.type === 'boolean') return false;
  // number/integer/string/undefined all default to an empty string — an
  // empty numeric input is represented as `''`, not `0` or `NaN` (matches
  // `CommonNumberField`'s own `value: number | null` contract at the
  // `null` end, and avoids seeding a spurious `0` into a brand-new form).
  return '';
}

/**
 * Builds the initial `data` object for a newly-selected credential type —
 * one entry per schema property, defaulted per `initialValueForSchemaField`.
 * Hidden properties (`metadata.hidden`) are still included (the baseline
 * only hides them from the FORM, not from the submitted payload).
 */
export function initialDataForSchema(schema: ConfigSchemaNode | undefined): Record<string, unknown> {
  const properties = schema?.properties ?? {};
  const result: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(properties)) {
    result[key] = initialValueForSchemaField(property);
  }
  return result;
}
