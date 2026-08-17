/**
 * Public API — spec §3.3 (named exports only). Unit W-shell (spec §9.3),
 * the highest-leverage unit in this batch: every future `pages/**` route
 * target composes its content inside `<AppShell>`.
 *
 * Ported from `[fsd]/app/layout/{AppLayout,MainPanel,MainSidebar}.jsx`,
 * `components/{UnsavedDialog,ConfirmRedirectModal}.jsx`,
 * `hooks/useBrowserPageTitle.js`. `AppShell.tsx`'s own header documents
 * every reduced-scope/dropped piece (`MaintenanceBanner`,
 * `InteractiveTourProvider`/`SupportAssistantWidget`, the import wizard) in
 * full; `NavBlockerDialog`'s and `model/navBlocker.store.ts`'s headers
 * document the nav-blocker's known layering gap.
 *
 * `readPersistedProject`/`writePersistedProject` are NOT here any more. They
 * moved to `shared/lib/selectedProjectPersistence.ts` (issue #493). `app/`'s
 * session store needs the persisted project id, `no-deep-slice-import` allows
 * `app/` to enter a widget through this file only, and this file exports
 * `AppShell` — so reading two storage keys pulled the whole shell, the sidebar
 * and the notification centre into the initial bundle, 120 KiB gzip of it. The
 * helper itself only ever wrapped `shared/lib/storage.ts`, whose own header
 * already names `local:el.project.id` as its example key, so `shared/` is
 * where both layers can reach it without either importing the other.
 */
export { AppShell } from './ui/AppShell';
export type { AppShellProps } from './ui/AppShell';
export { ConfirmRedirectModal } from './ui/ConfirmRedirectModal';
export type { ConfirmRedirectModalProps } from './ui/ConfirmRedirectModal';
export { NavBlockerDialog } from './ui/NavBlockerDialog';
export { PageTitleSetter } from './ui/PageTitleSetter';
export { derivePageTitle } from './lib/pageTitle';
export { useNavBlockerStore } from './model/navBlocker.store';
export type { StreamingType } from './model/navBlocker.store';
export {
  useUnsavedChangesNavBlocker,
  disarmUnsavedChangesNavBlocker,
  UNSAVED_CHANGES_WARNING,
} from './model/useUnsavedChangesNavBlocker';
export { useSelectedProjectStore } from './model/selectedProject.store';
export type { SelectedProject } from './model/selectedProject.store';
export { useSelectedProject } from './model/useSelectedProject.hooks';
export type { UseSelectedProjectResult } from './model/useSelectedProject.hooks';
