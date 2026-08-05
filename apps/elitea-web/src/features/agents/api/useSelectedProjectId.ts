import { useRouteContext } from '@tanstack/react-router';

/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`, backed by
 * `state.settings.project.id`, falling back to `personal_project_id`).
 *
 * Local duplicate of `features/apps/api/useSelectedProjectId.ts` (unit
 * F5's Wave-2 partition), NOT an import of it: `no-sideways-features`
 * forbids one `features/*` slice importing another, and no
 * shared/entities primitive for "the selected project id" exists yet — see
 * that file's own doc comment for the full seam rationale (this is a
 * byte-for-byte-identical copy of it). Every Wave-2 `A*`/`C*` unit that
 * needs a project id hits this exact same duplication until a real `R2`
 * root-context consumer or a promoted `entities/` primitive removes the
 * need for it.
 *
 * `src/app/router-context.ts` (unit R1) already defines the intended seam
 * for exactly this: `RouterContext.auth.getSelectedProjectId()`, installed
 * as the TanStack Router root context (`router.tsx:42`,
 * `context: { auth: stubAuthContext }`) precisely so a not-yet-landed real
 * implementation (unit R2) can be swapped in later with zero call-site
 * changes anywhere that already reads it this way. `useRouteContext` is a
 * plain `@tanstack/react-router` hook — reading the merged root context this
 * way needs no import from `src/app/` or `src/routes/`, so it stays inside
 * the R-L1 downward-only direction. `strict: false` (verified against the
 * installed `@tanstack/router-core@1.170.18` types, `StrictOrFrom`: `TStrict
 * extends false` drops the required `from` field entirely) reads the ROOT's
 * merged context from any component under `<RouterProvider>`, without this
 * file needing to name (or import) any specific route.
 *
 * Until R2 replaces `stubAuthContext`, `getSelectedProjectId()` always
 * returns `undefined` here — every query this feature gates on it
 * (`enabled: projectId !== undefined`) therefore stays correctly disabled
 * rather than firing against a wrong/empty id.
 */

/** Structural, not nominal — the router's registered context type is not imported (see doc comment above); this only requires the one method this hook actually calls. */
interface SelectedProjectIdContext {
  readonly auth?: {
    readonly getSelectedProjectId?: () => string | undefined;
  };
}

function isSelectedProjectIdContext(value: unknown): value is SelectedProjectIdContext {
  return typeof value === 'object' && value !== null;
}

/** Pure extraction, unit-tested directly (no router needed) — the hook below is a one-line wrapper over this. */
export function selectProjectId(context: unknown): string | undefined {
  if (!isSelectedProjectIdContext(context)) return undefined;
  return context.auth?.getSelectedProjectId?.();
}

export function useSelectedProjectId(): string | undefined {
  const context: unknown = useRouteContext({ strict: false });
  return selectProjectId(context);
}
