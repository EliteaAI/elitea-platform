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
 * useIsVersionNotFound.hooks.js` (`EditApplication.jsx:55-61`). The pure
 * predicate half (`!versions.some(v => String(v.id) === String(version))`)
 * is already promoted as `entities/version`'s `isVersionNotFound` — this
 * hook is the thin, router-adjacent memo wrapper around it that the
 * baseline itself is: `entities/` may not hold a React hook (spec §3.2:
 * "pure selectors" only), so the wrapper lives here instead, local to its
 * only caller (`EditApplication.tsx`, this unit).
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
