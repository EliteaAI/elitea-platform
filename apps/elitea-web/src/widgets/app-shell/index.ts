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
export { useSelectedProjectStore } from './model/selectedProject.store';
export type { SelectedProject } from './model/selectedProject.store';
export { useSelectedProject } from './model/useSelectedProject.hooks';
export type { UseSelectedProjectResult } from './model/useSelectedProject.hooks';
export { readPersistedProject, writePersistedProject } from './lib/selectedProjectPersistence';
export type { PersistedProject } from './lib/selectedProjectPersistence';
