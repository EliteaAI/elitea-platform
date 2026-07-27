import { useRouteContext } from '@tanstack/react-router';

/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`, backed by
 * `state.settings.project.id`, falling back to `personal_project_id`).
 *
 * **Cross-cutting gap, flagged for the record (not fixable inside this
 * unit's ownership fence):** no shared/entities primitive for "the selected
 * project id" exists anywhere in Wave 1's output as of this unit landing —
 * `entities/project` ships only types + pure selectors (no store/hook), and
 * the only stateful project-selection code in the tree is
 * `src/routes/$projectId.$.tsx`'s interim `getProjectStore()` (unit R3),
 * which lives in `src/routes/` — importing it here would violate R-L1 (a
 * `features/` slice may not import upward from `app`/`routes`) even setting
 * ownership aside. This almost certainly blocks every OTHER Wave-2 `A*`
 * unit the same way, not just this one.
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
 * rather than firing against a wrong/empty id, the same "safe by
 * construction, no destructive default" posture `router-context.ts`'s own
 * doc comment describes for its other not-yet-wired consumers (the route
 * guards). The moment R2 lands a real `auth` context, this hook starts
 * resolving a real project id with no change here or at any call site in
 * `features/apps`.
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
