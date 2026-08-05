import { useRouteContext } from '@tanstack/react-router';

/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`), duplicated locally for
 * `pages/pipelines/**` — same seam (`RouterContext.auth.getSelectedProjectId()`,
 * unit R1/R2), same duplication rationale `pages/agents/lib/
 * useSelectedProjectId.ts` (Wave-2 unit A1g) already documents in full: it is
 * not re-exported from `features/apps`'s public `index.ts`, so there is no
 * R-L3-legal way to import it from outside that slice, and `pages/` may not
 * import `src/routes/-guards/*` (routes compose pages, not the reverse).
 * `no-sideways-*` only restricts `entities/`/`features/`; nothing forbids two
 * `pages/` sibling directories independently reproducing the same
 * two-function body against the same router-context seam, matching this
 * exact precedent.
 */
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
