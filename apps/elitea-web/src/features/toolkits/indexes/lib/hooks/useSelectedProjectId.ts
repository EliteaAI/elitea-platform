import { useRouteContext } from '@tanstack/react-router';

/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`, backed by
 * `state.settings.project.id`, falling back to `personal_project_id`).
 *
 * Local duplicate of `features/agents/api/useSelectedProjectId.ts` (byte-
 * for-byte identical), NOT an import of it: `no-sideways-features` forbids
 * one `features/*` slice importing another, and no shared/entities
 * primitive for "the selected project id" exists yet — see that file's own
 * doc comment for the full seam rationale. Every Wave-2 unit that needs a
 * project id hits this exact same duplication until a real `R2` root-context
 * consumer or a promoted `entities/` primitive removes the need for it.
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
