import { useRouteContext } from '@tanstack/react-router';

interface ProjectContext {
  readonly auth?: {
    readonly getSelectedProjectId?: () => string | undefined;
  };
}

export function selectProjectId(context: unknown): string | undefined {
  if (typeof context !== 'object' || context === null) return undefined;
  return (context as ProjectContext).auth?.getSelectedProjectId?.();
}

export function useSelectedProjectId(): string | undefined {
  return selectProjectId(useRouteContext({ strict: false }));
}
