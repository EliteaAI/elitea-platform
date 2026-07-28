/**
 * Local duplicate of `features/apps/api/useSelectedProjectId.ts`'s own
 * port of `apps/elitea-ui/src/hooks/useSelectedProject.jsx`. Duplicated,
 * not imported: `no-sideways-features` forbids `features/pipelines`
 * reaching into `features/apps`. See that file's own doc comment for the
 * full "no shared/entities primitive for this exists yet, `router-
 * context.ts`'s `auth.getSelectedProjectId()` is the intended seam"
 * rationale (identical situation here — not repeated verbatim).
 *
 * Needed by `useFunctionInputMapping.ts` (`useToolkitTypeSchemas.ts`'s own
 * `projectId` parameter, and the dynamic-tool-schema query).
 */
import { useRouteContext } from '@tanstack/react-router';

interface SelectedProjectIdContext {
  readonly auth?: {
    readonly getSelectedProjectId?: () => string | undefined;
  };
}

function isSelectedProjectIdContext(value: unknown): value is SelectedProjectIdContext {
  return typeof value === 'object' && value !== null;
}

export function selectProjectId(context: unknown): string | undefined {
  if (!isSelectedProjectIdContext(context)) return undefined;
  return context.auth?.getSelectedProjectId?.();
}

export function useSelectedProjectId(): string | undefined {
  const context: unknown = useRouteContext({ strict: false });
  return selectProjectId(context);
}
