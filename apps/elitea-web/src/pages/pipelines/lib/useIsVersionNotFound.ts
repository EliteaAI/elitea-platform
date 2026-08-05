import { useMemo } from 'react';

import { isVersionNotFound, type VersionSummary } from '@/entities/version';

export interface UseIsVersionNotFoundArgs {
  readonly version: string | undefined;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly versions: readonly VersionSummary[] | undefined;
  readonly skip?: boolean;
}

/**
 * Ported from `apps/elitea-ui/src/[fsd]/entities/version/lib/hooks/
 * useIsVersionNotFound.hooks.js` (`EditPipeline.jsx:59-65`,
 * `useIsVersionNotFound({version, isFetching, isError, versions:
 * initialValues?.versions, skip: isFromCreation})`). The pure predicate half
 * is already promoted as `entities/version`'s `isVersionNotFound` (this is
 * legitimate downward `entities/` reuse, not a duplicated body) — this hook
 * is the thin, router-adjacent memo wrapper the baseline itself is:
 * `entities/` may not hold a React hook (spec §3.2: "pure selectors" only),
 * so the wrapper lives here, local to its only caller (`EditPipeline.tsx`,
 * this unit, A2m). Same shape as `pages/agents/lib/useIsVersionNotFound.ts`
 * (Wave-2 unit A1g) — duplicated rather than imported across a
 * `pages/agents` <-> `pages/pipelines` boundary, matching this codebase's
 * "each page-owned surface is independently deletable" posture (see
 * `pages/pipelines/ui/PipelineListPanel.tsx`'s doc comment for the same
 * rationale spelled out in full).
 */
export function useIsVersionNotFound({
  version,
  isFetching,
  isError,
  versions,
  skip = false,
}: UseIsVersionNotFoundArgs): boolean {
  return useMemo(() => {
    if (skip) return false;
    if (version === undefined || version === '' || isFetching || isError) return false;
    if (versions === undefined || versions.length === 0) return false;
    return isVersionNotFound(version, versions);
  }, [skip, version, isFetching, isError, versions]);
}
