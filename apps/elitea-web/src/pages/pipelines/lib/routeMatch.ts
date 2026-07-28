import { useRouterState } from '@tanstack/react-router';

/**
 * Ported from `apps/elitea-ui/src/hooks/useIsFromSpecificPageHooks.jsx`'s
 * `useIsFromPipelineDetail`/`useIsFrom` — consumed by this unit's own
 * `useSavePipeline.ts`/`useIsPipelineYamlCodeDirty.ts`
 * (`pages/Pipelines/useSavePipeline.js:9-10`,
 * `useIsPipelineYamlCodeDirty.js:8-9`).
 *
 * **Disclosed deviation, same reasoning `features/agents/lib/
 * useIsFromApplication.ts` (Wave-2 unit A1e) already established for the
 * sibling `useIsFrom`/route-prefix check:** the baseline's
 * `useIsFromPipelineDetail` uses react-router-dom's `useMatch({path})`
 * against `RouteDefinitions.PipelineDetail` (`/pipelines/:tab/:agentId`),
 * `RouteDefinitions.CreatePipeline` (`/pipelines/create`), and
 * `${PipelineDetail}/:version`. This app's router is TanStack Router (unit
 * R1); `useRouterState`'s resolved `location.pathname` plus a plain regex
 * match against the SAME three real route paths (verified directly:
 * `src/routes/_shell/pipelines/create.tsx`,
 * `src/routes/_shell/pipelines/$tab.$agentId.tsx`,
 * `src/routes/_shell/pipelines/$tab.$agentId.$version.tsx`) reproduces the
 * identical "is the current screen a pipeline editor screen" predicate
 * without importing `src/routes/**` from `pages/` (an upward-composition
 * inversion, same constraint `useCorrectUserNameInUrl.ts`, this unit, also
 * documents).
 */

const PIPELINE_DETAIL_PATTERNS: readonly RegExp[] = [
  /^\/pipelines\/create$/,
  /^\/pipelines\/[^/]+\/[^/]+$/,
  /^\/pipelines\/[^/]+\/[^/]+\/[^/]+$/,
];

/** Pure, unit-testable directly against a pathname string. */
export function isPipelineDetailPath(pathname: string): boolean {
  return PIPELINE_DETAIL_PATTERNS.some((pattern) => pattern.test(pathname));
}

export function useIsFromPipelineDetail(): boolean {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  return isPipelineDetailPath(pathname);
}

/** Pure, unit-testable directly against a pathname string — the baseline's `useIsFrom(path)`'s `pathname.startsWith(path)` body. */
export function pathnameStartsWith(pathname: string, prefix: string): boolean {
  return pathname.startsWith(prefix);
}

export function useIsFromChat(): boolean {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  return pathnameStartsWith(pathname, '/chat');
}
