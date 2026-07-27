/**
 * Public API — spec §3.3: named exports only.
 *
 * `UserPublicPage` is ROUTE-041's route target. It is NOT yet wired into
 * `src/routes/_shell/user-public/$tab.tsx` (outside this unit's ownership
 * fence, `src/pages/user-public/` only) — see the A12 report for the exact
 * one-line change a route-wiring pass needs.
 *
 * ROUTE-042…046 (the five `/user-public/{agents,pipelines,toolkits,mcps,apps}/:id`
 * detail routes) have no page here: each reuses another domain's edit/detail
 * component in the baseline (`EditApplication`, `EditPipeline`,
 * `EditToolkit`, `AppDetail`), and none of `features/agents`,
 * `features/pipelines`, `features/toolkits` exist yet in this wave batch
 * (`features/apps`/`features/mcps` exist but have no `index.ts` yet as of
 * this unit landing). See the A12 report.
 */
export { UserPublicPage } from './ui/UserPublicPage';
export type { UserPublicPageProps } from './ui/UserPublicPage';
