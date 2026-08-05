/**
 * Pure command-resolution logic for the create button (spec SHELL-013..026).
 * Split out of the UI component so it can be exercised without mounting
 * anything (§3.6: "a component either renders or fetches, never both" —
 * extended here to "or decides", the same reasoning `BaseModal`'s
 * `ModalActions`/`ModalHeader` split documents).
 *
 * Old app: `CreateEntityButton.jsx`'s `handleCommand`/`isSimpleCreateRoute`/
 * `currentLabel` `useMemo`s. Reduced scope, documented at each divergence:
 *  - `shouldReplaceThePage` collapses the old app's 5-way OR (application/
 *    pipeline/toolkit/credential DETAIL-page sniffing via path regexes tied
 *    to the OLD flat `/agents/:id` shape, which no longer exists — R1's real
 *    routes are `/agents/$tab/$agentId`) down to just `isCreatingNow`
 *    (pathname contains `/create`). Effect of the drop: one avoidable extra
 *    browser-history entry when re-choosing a different entity type from an
 *    agent/pipeline/toolkit/credential DETAIL page (not the create page) —
 *    cosmetic, not a navigation-correctness bug (`navigate()` still lands on
 *    the right screen either way).
 *  - No `location.state.routeStack` breadcrumb payload (see `constants.ts`
 *    header) and no `dispatch(artifactActions.setBucket(null))` Redux
 *    side-effect (the artifact-bucket-create page owns its own "no bucket
 *    selected yet" state now — there is no Redux slice to clear).
 */
import type { CreateEntityKind } from './constants';
import { CREATE_ENTITY_PERMISSIONS, ROUTE_TO_ENTITY_KIND, SIMPLE_CREATE_ROUTE_SEGMENTS } from './constants';
import { CREATE_ROUTES } from './routes';

export interface CreateCommandTarget {
  readonly to: string;
  readonly search: Readonly<Record<string, string>>;
  readonly replace: boolean;
}

/** SHELL-026: routes where the button never needs a dropdown — it's just "create the one thing this page is about", or there is nothing sensible to create at all. */
export function isSimpleCreateRoute(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return SIMPLE_CREATE_ROUTE_SEGMENTS.some((segment) => lower.includes(segment));
}

/**
 * The entity kind implied by the current URL, or `undefined` on an
 * unrecognised route (`isSimpleCreateRoute` routes and truly unknown ones
 * alike).
 *
 * `isSimpleCreateRoute` is checked FIRST and short-circuits to `undefined`.
 * This matters concretely for `/agents-hub`: it is a `SIMPLE_CREATE_ROUTE`
 * (old app: `RouteToLabelMap`'s FIRST entry maps `AgentHub -> null`,
 * deliberately ordered ahead of `Applications -> 'Agent'` so `.find()` hits
 * it first) but its path also contains the `/agents` substring that would
 * otherwise match the `agent` entity kind below. The old app relies on
 * array-order to break this tie; this port makes the precedence an
 * explicit, independently-testable rule instead.
 */
export function currentEntityFromPathname(pathname: string): CreateEntityKind | undefined {
  if (isSimpleCreateRoute(pathname)) return undefined;
  const lower = pathname.toLowerCase();
  const match = ROUTE_TO_ENTITY_KIND.find(({ segment }) => lower.includes(segment.toLowerCase()));
  return match?.kind;
}

/** SHELL default selection: the old app defaults to "Chat" when the current route implies nothing else. */
export function defaultEntityKind(pathname: string): CreateEntityKind {
  return currentEntityFromPathname(pathname) ?? 'chat';
}

/** Does `permissions` satisfy at least one of `kind`'s required permissions (or does `kind` require none)? */
export function hasCreatePermission(kind: CreateEntityKind, permissions: ReadonlySet<string>): boolean {
  const required = CREATE_ENTITY_PERMISSIONS[kind];
  if (!required || required.length === 0) return true;
  return required.some((permission) => permissions.has(permission));
}

/**
 * Per-kind destination + search params, as a function of whether the
 * current page is itself a `/create` page (`replace`). A lookup table
 * (rather than a `switch`) keeps this well under the §3.5 cyclomatic-
 * complexity budget — each entry is a straight-line data mapping, not a
 * branch.
 */
const COMMAND_TARGETS: Readonly<
  Record<CreateEntityKind, (replace: boolean) => CreateCommandTarget>
> = {
  chat: (replace) => ({ to: CREATE_ROUTES.chat, search: { create: '1' }, replace }),
  agent: (replace) => ({ to: CREATE_ROUTES.agentsCreate, search: {}, replace }),
  skill: (replace) => ({ to: CREATE_ROUTES.skillsCreate, search: {}, replace }),
  pipeline: (replace) => ({ to: CREATE_ROUTES.pipelinesCreate, search: {}, replace }),
  toolkit: (replace) => ({ to: CREATE_ROUTES.toolkitsCreate, search: {}, replace }),
  // Old app: navigates to the catalog tab to pick an app template, not a dedicated create page.
  application: (replace) => ({ to: CREATE_ROUTES.appsCatalog, search: {}, replace }),
  mcp: (replace) => ({ to: CREATE_ROUTES.mcpsCreate, search: {}, replace }),
  credential: (replace) => ({ to: CREATE_ROUTES.credentialsCreate, search: {}, replace }),
  bucket: (replace) => ({ to: CREATE_ROUTES.artifactsCreateBucket, search: {}, replace }),
  configuration: (replace) => ({
    to: CREATE_ROUTES.settingsCreateConfiguration,
    search: { from: 'model-configuration' },
    replace,
  }),
  token: (replace) => ({ to: CREATE_ROUTES.settingsCreatePersonalToken, search: {}, replace }),
  // secret/user: "stay on this page, open a sub-affordance" — same as old
  // app's Secret/User cases, which set a flag search param on the CURRENT
  // settings tab instead of a CommandPathMap destination. Always pushes
  // (never replaces): re-opening the row-create flag from wherever you are
  // should not eat the entry that got you to settings.
  secret: () => ({ to: CREATE_ROUTES.settingsSecrets, search: { createSecret: '1' }, replace: false }),
  user: () => ({ to: CREATE_ROUTES.settingsUsers, search: { inviteUsers: '1' }, replace: false }),
};

/**
 * Resolves a chosen entity kind to a navigation target. `pathname` decides
 * `replace` (see header) — collapses the old app's 5-way detail-page sniff
 * down to `isCreatingNow` (see this file's own header).
 */
export function resolveCreateCommand(kind: CreateEntityKind, pathname: string): CreateCommandTarget {
  const replace = pathname.includes('/create');
  return COMMAND_TARGETS[kind](replace);
}
