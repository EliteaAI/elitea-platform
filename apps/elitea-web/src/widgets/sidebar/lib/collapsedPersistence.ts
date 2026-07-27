/**
 * Reads/writes the sidebar-collapsed flag's persisted value.
 *
 * `createStorage('local')` is called FRESH inside each function (never
 * cached at this module's top level) — verified necessary, not stylistic:
 * `shared/lib/storage.ts`'s `createStorage` captures `window.localStorage`
 * eagerly at CALL time (`areaOf(area)`), and under vitest 4 + Node 24,
 * Node's own experimental `localStorage` global shadows jsdom's until a
 * test explicitly installs `@/test/webstorage`'s shim (F4's documented
 * gap — `src/test/setup.ts` does not install it globally). A module-scope
 * `createStorage('local')` call in a file reachable from a zustand store
 * created at ITS OWN module scope (`sidebarCollapsed.store.ts`) would
 * capture `undefined` permanently for any test importing this widget
 * before calling the shim, no matter the import order inside the test
 * file (ES import evaluation order cannot be fixed by moving a plain call
 * expression around — only by controlling WHEN `createStorage` itself
 * runs). Calling it lazily, at read/write time (component mount /
 * user-interaction time, always after a test's shim call has run), avoids
 * the whole class of ordering hazard.
 */
import { createStorage } from '@/shared/lib/storage';

const STORAGE_KEY = 'sidebar.collapsed';

export function readPersistedCollapsed(): boolean {
  return createStorage('local').get(STORAGE_KEY) === '1';
}

export function writePersistedCollapsed(collapsed: boolean): void {
  createStorage('local').set(STORAGE_KEY, collapsed ? '1' : '0');
}
