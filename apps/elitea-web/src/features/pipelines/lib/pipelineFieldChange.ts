/**
 * Local, `features/pipelines`-owned duplicate of `features/agents/lib/
 * agentFieldChange.ts`'s `setFieldValueAtPath` — a generic, immutable
 * dot-path setter matching `PipelineFieldChange`'s contract
 * (`../model/types.ts`). Duplicated, not imported: `no-sideways-features`
 * forbids `features/pipelines` reaching into `features/agents` even for a
 * byte-for-byte-identical utility — same precedent as this slice's
 * `useHasPermission.ts`/`useValidatePipelineVersion.ts`.
 *
 * Only object traversal is supported (no array-index path segments) — same
 * scope limitation as the agents original, matching this file's own real
 * call sites (`ui/PipelineEditor.tsx`'s create-mode field paths, all plain
 * nested objects).
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
