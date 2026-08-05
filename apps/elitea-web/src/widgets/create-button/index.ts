/**
 * Public API — spec §3.3 (named exports only). Unit W-shell (spec §9.3).
 *
 * Owns: the sidebar's global "Create" button (spec SHELL-013..026). Ported
 * from `apps/elitea-ui/src/[fsd]/widgets/sidebar-root/ui/button/
 * CreateEntityButton.jsx` + `lib/constants/createEntity.constant.js`.
 *
 * Reduced from the baseline, documented precisely (rather than faked) at
 * each point:
 *  - No `location.state.routeStack` breadcrumb trail — its only consumer is
 *    a page-level breadcrumb component that does not exist in any landed
 *    Wave-2 unit yet.
 *  - `shouldReplaceThePage`'s old app 5-way detail-page sniff collapses to
 *    an `isCreatingNow` check (`lib/command.ts` header has the full
 *    rationale — cosmetic history-stack difference only, not a navigation
 *    bug).
 *  - No `dispatch(artifactActions.setBucket(null))` — there is no Redux
 *    slice to clear; the create-bucket page owns its own initial state.
 *  - The old app's fork/import wizard (`entities/import-wizard/**`, opened
 *    from this button per `parity/GRAPH.md:93`) is still NOT ported — the
 *    button has no "import"/"fork" affordance at all. This was originally
 *    disclosed as blocked on missing `jszip`/`uuid`/a flow editor; those
 *    three are now all available (`jszip` is a direct dependency,
 *    `crypto.randomUUID()` is this codebase's standing `uuid` substitute,
 *    and `features/pipelines` exports a ready-to-compose `PipelineEditor`),
 *    so the blocker is stale, but actually wiring the wizard up is a
 *    substantial feature-composition change (build `entities/import-wizard`
 *    from the old app's 22-file tree, then compose it here) — out of scope
 *    for this widget's own file set.
 *
 * `isCreatingNewConversation` (chat feature) IS now read, via
 * `entities/conversation`'s `useChatSessionStore` — see
 * `ui/CreateEntityButton.tsx`'s `shouldDisableCreatingChat`. This closes
 * the gap this header used to disclose here (a chat unit has since landed
 * the queryable "creating" flag).
 */
export { CreateEntityButton } from './ui/CreateEntityButton';
export type { CreateEntityButtonProps } from './ui/CreateEntityButton';
export type { CreateEntityKind, CreateEntityOption } from './lib/constants';
export { createEntityOptions } from './lib/constants';
export {
  currentEntityFromPathname,
  defaultEntityKind,
  hasCreatePermission,
  isSimpleCreateRoute,
  resolveCreateCommand,
} from './lib/command';
export type { CreateCommandTarget } from './lib/command';
