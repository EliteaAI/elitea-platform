/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/agent/lib/helpers/conversationStarters.helpers.js`
 * (single-export file, byte-for-byte). Used to coerce a conversation-starter
 * form field's raw value (which may be `null`/`undefined` when a field is
 * cleared) to a definite string for controlled-input rendering.
 *
 * Parameter narrowed from the baseline's untyped `value` to `string |
 * number | boolean | null | undefined` — a conversation-starter form field
 * is a plain text/array input, never an object/array itself, and this
 * matches this codebase's established fix for `no-base-to-string` on a
 * genuinely-`unknown` stringify call (see `features/credentials/api/
 * configurations.ts`'s `toQueryParamValue`, same rationale: an object with
 * no custom `toString` would silently stringify to `"[object Object]"`,
 * which this narrowing makes structurally unreachable rather than
 * suppressing the lint).
 */
export function toString(value: string | number | boolean | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}
