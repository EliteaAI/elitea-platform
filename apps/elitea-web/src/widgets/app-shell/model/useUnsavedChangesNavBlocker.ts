/**
 * Arms the app-wide unsaved-changes guard from an editor page's own dirty
 * state — the missing half of the mechanism `NavBlockerDialog` already
 * implements (#133).
 *
 * `NavBlockerDialog` (this same unit) holds a real TanStack `useBlocker`
 * keyed on `isBlockNav || isStreaming` (plus a pathname-changed check) and
 * `AppShell` mounts it under every page, so the blocking half worked. What
 * was missing was any SETTER outside the chat process: `setBlockNav` had
 * exactly three production call sites, all in `processes/chat/ui/
 * ChatWithEditors.hooks.ts` (the chat-EMBEDDED agent/pipeline/toolkit
 * editors). The STANDALONE `/agents/**` and `/pipelines/**` editor pages
 * never touched the store, so typing into an agent and clicking any nav
 * link navigated straight through and lost the edit — data loss, not just a
 * missing dialog.
 *
 * This hook is the same `setBlockNav(dirty, message)` call those three chat
 * sites already make, packaged so a page can express it as one line against
 * whatever "dirty" means for that page (RHF `formState.isDirty`, a flow
 * editor's own dirty flag, or both OR-ed together).
 *
 * **Unmount always disarms.** The flag lives in a module-level singleton
 * store, so an editor that navigated away (or was replaced by a not-found
 * panel) must not leave the whole app blocked. The cleanup also runs
 * between `isDirty` transitions, where the effect body immediately re-sets
 * the correct value — a false→true→false flicker within one commit that no
 * blocker can observe, since `shouldBlockFn` is only consulted on an actual
 * navigation attempt.
 *
 * **Confirming a blocked navigation still works.** `NavBlockerDialog`'s
 * `handleConfirm` calls `setBlockNav(false)` itself and then `proceed()`.
 * This hook's effect does not re-run on that (its `isDirty` dep has not
 * changed), so the flag stays down and the navigation completes — then the
 * page unmounts and the cleanup below is a no-op repeat. Cancelling leaves
 * the flag up, which is what keeps the next attempt blocked too.
 *
 * Layering: `widgets/app-shell` is where the store lives today (see
 * `navBlocker.store.ts`'s own header on the known `entities/`/`shared/`
 * relocation gap). Callers are `pages/**`, which sits ABOVE `widgets/**`,
 * so this is a legal downward import. A `features/**` caller would NOT be
 * legal — that is exactly the relocation that header asks for, and no
 * `features/*` unit needs to set the flag today.
 */
import { useEffect } from 'react';

import { t } from '@/shared/i18n';

import { useNavBlockerStore } from './navBlocker.store';

/**
 * Same wording the chat-embedded editors use
 * (`ChatWithEditors.hooks.ts`'s `NAV_BLOCK_WARNING`) — one guard, one
 * message, regardless of which editor armed it.
 */
export const UNSAVED_CHANGES_WARNING = t(
  'widgets.appShell.navBlocker.unsavedChanges',
  'You have unsaved changes in the editor. Are you sure you want to leave?',
);

/**
 * Lowers the guard for a navigation the user has ALREADY decided on — a
 * successful save, or an explicit discard/cancel. Without this, an editor
 * armed by `useUnsavedChangesNavBlocker` would block its own post-save
 * `navigate(...)` and prompt "you have unsaved changes" about changes it
 * just persisted.
 *
 * Safe against the hook re-arming behind it: the effect there is keyed on
 * `isDirty`, which does not change when this is called, so it does not
 * re-run. The editor then unmounts and its cleanup repeats this same
 * no-op. Same shape as `NavBlockerDialog`'s own `handleConfirm`, which
 * calls `setBlockNav(false)` before `proceed()` for exactly this reason.
 *
 * This takes effect IMMEDIATELY, in the same event handler, because
 * `NavBlockerDialog`'s `shouldBlockFn` reads the live store snapshot rather
 * than closing over its last rendered value — see that call site's own
 * comment, and the J16 timeout that proved the closure version wrong.
 */
export function disarmUnsavedChangesNavBlocker(): void {
  useNavBlockerStore.getState().setBlockNav(false, UNSAVED_CHANGES_WARNING);
}

/**
 * @param isDirty whether the editor currently holds unsaved edits.
 * @param message overrides the default warning shown in the dialog.
 */
export function useUnsavedChangesNavBlocker(isDirty: boolean, message: string = UNSAVED_CHANGES_WARNING): void {
  useEffect(() => {
    useNavBlockerStore.getState().setBlockNav(isDirty, message);
    return () => {
      useNavBlockerStore.getState().setBlockNav(false, message);
    };
  }, [isDirty, message]);
}
