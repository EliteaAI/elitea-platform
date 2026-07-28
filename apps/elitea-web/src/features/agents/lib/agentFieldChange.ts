/**
 * A generic, immutable dot-path setter matching `AgentFieldChange`'s
 * contract (`../model/types.ts`: "mirrors Formik's own
 * `setFieldValue(path, value)` signature exactly"). `CreateAgentForm.tsx`
 * (A1c, real, landed) calls `onFieldChange` with paths like `'name'`,
 * `'version_details.instructions'`, `'version_details.meta.step_limit'`,
 * `'version_details.variables'` — this is the one implementation of that
 * contract AgentEditor (the only owner of create-mode `values` state) needs.
 *
 * Only object traversal is supported (no array-index path segments): every
 * real call site above stays within plain nested objects, and Formik's own
 * `setFieldValue` path syntax is a strict superset this app has no other
 * consumer of yet — implementing array-index segments here would be
 * speculative generality with no real caller to verify it against.
 */
export function setFieldValueAtPath<T extends object>(target: T, path: string, value: unknown): T {
  const segments = path.split('.');
  return setAtSegments(target, segments, value) as T;
}

function setAtSegments(target: unknown, segments: readonly string[], value: unknown): unknown {
  const [head, ...rest] = segments;
  if (head === undefined) return value;

  const base: Record<string, unknown> = typeof target === 'object' && target !== null ? { ...(target as Record<string, unknown>) } : {};
  base[head] = rest.length === 0 ? value : setAtSegments(base[head], rest, value);
  return base;
}
