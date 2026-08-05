/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`, backed by
 * `state.settings.project.id`, falling back to `personal_project_id`).
 *
 * Local duplicate of `features/agents/api/useSelectedProjectId.ts` /
 * `features/apps/api/useSelectedProjectId.ts` (byte-for-byte identical),
 * NOT an import of either: `no-sideways-features` forbids one `features/*`
 * slice importing another, and no `shared`/`entities` primitive for "the
 * selected project id" exists yet — see those files' own doc comments for
 * the full seam rationale. This sub-unit's four hooks that need a project
 * id (`useGetCurrentToolkitSchemas`/`useGetCurrentMCPSchemas`/
 * `useLoadToolkits`/`useToolkitChat`) all share this one local copy rather
 * than each duplicating it separately.
 *
 * `src/app/router-context.ts` (unit R1) defines the intended seam:
 * `RouterContext.auth.getSelectedProjectId()`, installed as the TanStack
 * Router root context. `useRouteContext({strict: false})` reads the merged
 * root context from any component under `<RouterProvider>` without this
 * file needing to import from `src/app/`/`src/routes/` (stays R-L1-downward).
 * Until a real R2 implementation replaces the stub, `getSelectedProjectId()`
 * always returns `undefined` here — every query gated on it
 * (`enabled: projectId !== undefined`) therefore stays correctly disabled.
 */
import { useRouteContext } from '@tanstack/react-router';

/** Structural, not nominal — the router's registered context type is not imported (see module doc comment); this only requires the one method this hook actually calls. */
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
