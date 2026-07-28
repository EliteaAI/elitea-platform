import { useRouteContext } from '@tanstack/react-router';

/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`). Duplicated locally
 * rather than imported from `features/apps/api/useSelectedProjectId.ts`:
 * that file's own doc comment already anticipates exactly this ("This
 * almost certainly blocks every OTHER Wave-2 A* unit the same way, not just
 * this one") and it is not re-exported from `features/apps`'s public
 * `index.ts` (verified directly — the barrel exports `ApplicationCatalog`,
 * `useAppDetail`, `appDetailErrorMessage`, `useHasApplications`, and the
 * tab helpers only), so there is no R-L3-legal way to import it from
 * outside that slice. Same body, same seam
 * (`RouterContext.auth.getSelectedProjectId()`, unit R1/R2) as the
 * original — see that file for the full router-context rationale.
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
