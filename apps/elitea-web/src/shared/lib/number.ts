/**
 * Numeric-parsing helper ported from apps/elitea-ui/src/common/utils.jsx
 * (unit S3, spec §9.3).
 */

const INT_STRING_RE = /^(0|[1-9]\d*)$/;

/**
 * Parses `value` as a non-negative integer with no leading zeros (`'0'`,
 * `'12'`, ... — NOT `'01'`, `'-1'`, `'1.5'`, `'1e3'`). Returns `''`
 * (preserved as-is, not `NaN`/`undefined`, old-app `utils.jsx:1040-1043`)
 * when `value` does not match.
 */
export function parseValueToIntNumber(value: string): number | '' {
  return INT_STRING_RE.test(value) ? parseInt(value, 10) : '';
}
