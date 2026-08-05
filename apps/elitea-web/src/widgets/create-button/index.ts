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
 *  - `isCreatingNewConversation` (chat feature) is not read — no chat
 *    feature slice exists yet to read it from; the button is never
 *    disabled for that reason (parity gap, will self-resolve once a chat
 *    unit lands a queryable "creating" flag the button can read via a
 *    prop, without this widget needing to import `features/chat-input`).
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
