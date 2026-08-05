/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`).
 *
 * Local duplicate of `features/toolkits/lib/hooks/useSelectedProjectId.ts`
 * (byte-for-byte identical), NOT an import of it: `no-deep-slice-import`
 * forbids `pages/` reaching a `features/` slice's internals directly (only
 * that slice's own `index.ts` is a legal entry point, spec §3.3/R-L3), and
 * `features/toolkits`' public `index.ts` does not export this hook (it is
 * intra-slice-only there too — see that file's own doc comment). Same
 * seam (`RouterContext.auth.getSelectedProjectId()`, unit R1/R2) as every
 * other duplicate of this exact hook already landed in this Wave-2 batch
 * (`pages/agents/lib/useSelectedProjectId.ts`, `pages/pipelines/lib/
 * useSelectedProjectId.ts`, `features/apps/api/useSelectedProjectId.ts`,
 * `features/toolkits/lib/hooks/useSelectedProjectId.ts` itself) — see any
 * of those files for the full router-context rationale.
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

/** Pure extraction, unit-tested directly (no router needed) — the hook below is a one-line wrapper over this. */
export function selectProjectId(context: unknown): string | undefined {
  if (!isSelectedProjectIdContext(context)) return undefined;
  return context.auth?.getSelectedProjectId?.();
}

export function useSelectedProjectId(): string | undefined {
  const context: unknown = useRouteContext({ strict: false });
  return selectProjectId(context);
}
