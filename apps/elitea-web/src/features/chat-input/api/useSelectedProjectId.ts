import { useRouteContext } from '@tanstack/react-router';

/**
 * "Currently selected project id" — the baseline's `useSelectedProjectId()`
 * (`apps/elitea-ui/src/hooks/useSelectedProject.jsx`, backed by
 * `state.settings.project.id`, falling back to `personal_project_id`).
 *
 * Local duplicate of `features/agents/api/useSelectedProjectId.ts` (and
 * every other Wave-2 feature slice's own copy — `features/apps/api/`,
 * `features/toolkits/lib/hooks/`, …), NOT an import of it:
 * `no-sideways-features` forbids one `features/*` slice importing another,
 * and no shared/entities primitive for "the selected project id" exists yet
 * — see `features/agents/api/useSelectedProjectId.ts`'s own doc comment for
 * the full seam rationale (this is a byte-for-byte-identical copy of it).
 * `useSpeakingModeLoop.ts` (this slice) needs `projectId` for both the ASR
 * model-listing query and the `asr_start` emit's `project_id` field.
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
