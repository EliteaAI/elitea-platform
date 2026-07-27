/**
 * Shared prop-shape types for this unit's (S1-E) JSON-schema-driven "tool
 * input variable" field family — `Common*Field`/`AnyOfPatternField`/
 * `SecretInputField`, each living at its own top-level `shared/ui/
 * ComponentName/` directory per this app's established one-directory-
 * per-component convention (NOT grouped under a `field/` parent the way the
 * baseline's source tree is). Baseline source: `apps/elitea-ui/src/[fsd]/
 * shared/ui/field/*.jsx`, one renderer per JSON-schema primitive type.
 *
 * The baseline components take two grouped blobs per field, `fieldProperties`
 * (UI-facing config: label/description/required/disabled/...) and `property`
 * (the raw JSON-schema node for that field: enum/minimum/maxLength/...).
 * Every `Common*Field`/`AnyOfPatternField`/`SecretInputField` in this unit
 * keeps that same two-object shape rather than flattening it into a dozen
 * individual props — both because it is genuinely how the baseline groups
 * "control config" vs. "schema-derived rendering hints" (so porting the
 * grouping preserves the actual API, not just the pixels), and because it
 * keeps each component under the §3.5 12-prop budget without inventing a
 * different shape than the one the reference behavior was written against.
 */

/** UI-facing config for one field, independent of its JSON-schema type. Baseline: `fieldProperties` (destructured `{label, description, isRequired, disabled}` — every `Common*Field` reads exactly this subset; the extra keys individual baseline files also read off the same object, `enumValues`/`codeLanguage`/`lines`/`clipboard`/`error`, are typed on the field-specific prop interfaces below instead of piled onto one shared type). */
export interface FieldMeta {
  label: string;
  description?: string;
  isRequired?: boolean;
  disabled?: boolean;
}

/**
 * Minimal JSON-schema node shape read by the `Common*Field` family (baseline's
 * raw `property` prop). Only the members these components actually branch on
 * are typed here — the real schema node may carry more, and every reader
 * takes it as `readonly`.
 */
export interface JsonSchemaProperty {
  /** `'integer' | 'number' | ...` — read only inside `anyOf` entries (CommonNumberField's Optional-type unwrap). */
  type?: string;
  multiline?: boolean;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  default?: unknown;
  items?: { enum?: readonly string[] };
  anyOf?: readonly JsonSchemaProperty[];
}
