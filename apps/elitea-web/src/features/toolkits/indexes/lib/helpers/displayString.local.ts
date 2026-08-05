/**
 * `index.metadata[key]` is `unknown` (the metadata bag has always been a
 * dynamic, backend-shaped record — see `model/indexesStore.ts`'s own
 * `IndexRow.metadata: Record<string, unknown>`). Several UI files display
 * one of its fields (`collection`, counts, etc.) as text; a bare
 * `String(unknown)` trips `no-base-to-string` (an object without a custom
 * `toString` would silently stringify to `"[object Object]"` — a real gap,
 * not a false positive, since the field's real shape is never guaranteed
 * client-side). This narrows to the primitive cases these fields can
 * actually be and stringifies only those, matching the pattern
 * `features/credentials/api/configurations.ts`'s own `toQueryParamValue`
 * uses for the identical reason.
 */
export function toDisplayString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}
