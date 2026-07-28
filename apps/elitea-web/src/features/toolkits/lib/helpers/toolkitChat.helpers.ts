/**
 * Ported verbatim from `apps/elitea-ui/src/[fsd]/features/toolkits/lib/
 * helpers/toolkitChat.helpers.js` (16 lines, Wave-2 unit A4b). Despite the
 * "Chat" filename, this validates a toolkit-test-chat's INPUT-VARIABLE form
 * against a JSON-Schema (the variables a "run tool"/"test tools" chat
 * prompt collects before it can run) — pure, no external dependencies in
 * the baseline.
 */

export interface ToolFormSchema {
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, { readonly error?: unknown } | undefined>>;
}

/**
 * True iff every `schema.required` field has a non-empty, non-zero value in
 * `variables` AND (for an array value) at least one item AND its own
 * schema property carries no `error` flag. Mirrors the baseline's
 * `!(Array.isArray(value) && value.length === 0) && !property.error`
 * exactly — a non-array falsy-but-present value (e.g. `false`) still fails
 * the earlier `value === undefined || ... || value === 0` check inherited
 * from the field being required in the first place, not from this second
 * clause.
 */
export function validateToolkitForm(schema: ToolFormSchema, variables: Readonly<Record<string, unknown>> | undefined): boolean {
  const requiredFields = schema.required ?? [];
  const inputVariables = variables ?? {};

  return requiredFields.every((field) => {
    const value = inputVariables[field];
    const property = schema.properties?.[field];

    if (value === undefined || value === null || value === '' || value === 0) {
      return false;
    }
    return !(Array.isArray(value) && value.length === 0) && !property?.error;
  });
}
