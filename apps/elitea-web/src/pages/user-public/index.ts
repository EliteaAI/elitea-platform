/**
 * Public API — spec §3.3: named exports only.
 *
 * `UserPublicPage` is ROUTE-041's route target. It is NOT yet wired into
 * `src/routes/_shell/user-public/$tab.tsx` (outside this unit's ownership
 * fence, `src/routes/**` — this cluster, A12-api-model, may not touch it).
 * That route file currently renders the Wave-1 placeholder verbatim:
 *
 * ```tsx
 * component: () => <RouteShell routeId="user-public.tab" fallback="User Public" />,
 * ```
 *
 * (adversarial-review finding 2: because of this, the `isPublicProjectId`
 * default-visitor fix in `api/useRouterAuth.ts` — finding 1 — is not yet
 * reachable by a real user; it will become live the moment the wiring below
 * lands, at which point it is ALREADY correct, no follow-up needed on that
 * half.) The exact change a route-wiring pass needs, spelled out here since
 * there is no other tracking document for it:
 *
 * 1. Replace that `component:` with one that reads `tab` from
 *    `Route.useParams()` (an untyped string — narrow it against
 *    `UserPublicTabValue`/`UserPublicTabs` from `./lib/constants`, falling
 *    back to `'all'` on no match, the same "unknown tab" behaviour
 *    `UserPublicPage` already applies to its OWN `visibleTabs` — see
 *    `ui/UserPublicPage.tsx`'s `activeIndex`/`activeTab`) and `statuses`
 *    from `Route.useSearch()`.
 * 2. Add `author_id`/`author_name` to that route's `validateSearch`: today
 *    it's `validateSearch: pickParams('statuses')` only
 *    (`src/routes/_shell/user-public/$tab.tsx:16`) — `author_id`/
 *    `author_name` are already declared in the shared registry
 *    (`src/routes/-search/params.ts`'s "shared/any" section) but never
 *    picked into THIS route, so `authorId`/`authorName` have no param
 *    source yet. Change it to
 *    `pickParams('statuses', 'author_id', 'author_name')`.
 * 3. Supply `onTabChange`/`onStatusesChange` as `useNavigate()` calls that
 *    update the `:tab` path param / `statuses` search param respectively
 *    (`replace: true`, matching the old app's own
 *    `setSearchParams(next, {replace: true})` in
 *    `apps/elitea-ui/src/pages/UserPublic/UserPublic.jsx:257-276`).
 * 4. Render `<UserPublicPage tab={...} onTabChange={...} statuses={...}
 *    onStatusesChange={...} authorId={...} authorName={...} />` in place of
 *    `<RouteShell .../>`. `projectId`/`permissions` need no route wiring —
 *    `UserPublicPage` already reads them itself via `api/useRouterAuth.ts`.
 *
 * See `src/routes/_shell/settings/notifications.tsx` for the established
 * shape of an already-wired route component in this app (route-level
 * `useRouteContext`/`useParams`/`useSearch`/`useNavigate`, `RouteShell`
 * swapped for the real page).
 *
 * ROUTE-042…046 (the five `/user-public/{agents,pipelines,toolkits,mcps,apps}/:id`
 * detail routes) have no page here: each reuses another domain's edit/detail
 * component in the baseline (`EditApplication`, `EditPipeline`,
 * `EditToolkit`, `AppDetail`), and none of `features/agents`,
 * `features/pipelines`, `features/toolkits` exist yet in this wave batch
 * (`features/apps`/`features/mcps` exist but have no `index.ts` yet as of
 * this unit landing).
 */
export { UserPublicPage } from './ui/UserPublicPage';
export type { UserPublicPageProps } from './ui/UserPublicPage';
