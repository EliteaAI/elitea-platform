import { useRouterState } from '@tanstack/react-router';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useIsFromApplication.js`
 * (`useFromApplications`, default export) — Wave-2 unit A1e.
 *
 * **Disclosed deviation:** the baseline's real check is two-part —
 * `routeStack[0].breadCrumb` (a custom breadcrumb array old app's
 * react-router `navigate(to, { state })` stashed in history state) OR a
 * `pathname.startsWith(...)` fallback against 4 `RouteDefinitions` entries
 * (`Applications`, `UserPublicApplicationDetail`, `Pipelines`,
 * `UserPublicPipelineDetail`). TanStack Router (this app's router, unit R1)
 * has no equivalent of react-router's arbitrary `history.state` passthrough
 * — `useRouterState`/`useLocation` only expose the resolved location, not a
 * caller-supplied state bag — so the `routeStack` half has no faithful
 * port; only the `pathname.startsWith` fallback (which is what actually
 * fires on a hard refresh/direct link, i.e. every case that matters for a
 * "was this menu opened from an agent or a pipeline screen" check) is
 * ported. The 4 route prefixes are real, verified route paths from this
 * app's own router (unit R1): `/agents` (`src/routes/_shell/agents/`),
 * `/pipelines` (`src/routes/_shell/pipelines/`),
 * `/user-public/agents` (`src/routes/_shell/user-public/agents.$agentId.tsx`),
 * `/user-public/pipelines` (`src/routes/_shell/user-public/pipelines.$agentId.tsx`).
 */

const AGENT_OR_PIPELINE_PATH_PREFIXES = [
  '/agents',
  '/user-public/agents',
  '/pipelines',
  '/user-public/pipelines',
] as const;

/** Pure, unit-testable directly against a pathname string. */
export function isAgentOrPipelinePath(pathname: string): boolean {
  return AGENT_OR_PIPELINE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * `true` when the current route is an agent or pipeline screen (list, edit,
 * or public-detail) — used by `ToolMenu` to decide whether a toolkit
 * attachment should be GA-tracked as coming from the agent/pipeline authoring
 * flow, matching the baseline's `isFromAgents`/`isFromPipelines` call sites.
 */
export function useIsFromApplication(): boolean {
  const pathname = useRouterState({ select: (routerState) => routerState.location.pathname });
  return isAgentOrPipelinePath(pathname);
}
