/**
 * Collapsed/expanded state for the admin nav — the store plus its persistence.
 *
 * Not a new mechanism: this is the shape `widgets/sidebar` already uses for the
 * main app's sidebar (`model/sidebarCollapsed.store.ts` +
 * `lib/collapsedPersistence.ts`), and both of that pair's constraints apply
 * verbatim here.
 *
 *  - **zustand, lazily constructed.** §2.3 (no Redux) and R-S2 ("no store may be
 *    created at module scope"), the latter mechanically enforced by
 *    `tools/lint-rules/rules/no-module-scope-store.mjs` against any `create()`
 *    outside a function. Hence the factory + memoised singleton.
 *  - **`createStorage('local')` called FRESH inside each accessor**, never
 *    cached at module scope. `shared/lib/storage.ts` captures `window.
 *    localStorage` eagerly at call time, and under vitest 4 + Node 24 Node's own
 *    experimental `localStorage` global shadows jsdom's until a test installs
 *    `@/test/webstorage`'s shim — a module-scope call would capture `undefined`
 *    permanently for any test importing this file first.
 *
 * The KEY differs deliberately. `widgets/sidebar` persists under
 * `sidebar.collapsed`; the admin bundle is a different SPA on the SAME ORIGIN,
 * so reusing that key would make collapsing the admin nav collapse the product
 * sidebar and vice versa — two unrelated preferences silently aliased through
 * `localStorage`. `el.` namespacing is unchanged, so the logout sweep
 * (`clearNamespace()`, §5.4) still reaches it.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import { createStorage } from '@/shared/lib/storage';

const STORAGE_KEY = 'admin.nav.collapsed';

export function readPersistedAdminNavCollapsed(): boolean {
  return createStorage('local').get(STORAGE_KEY) === '1';
}

export function writePersistedAdminNavCollapsed(collapsed: boolean): void {
  createStorage('local').set(STORAGE_KEY, collapsed ? '1' : '0');
}

interface AdminNavCollapsedState {
  readonly collapsed: boolean;
  readonly setCollapsed: (collapsed: boolean) => void;
}

type AdminNavCollapsedStore = UseBoundStore<StoreApi<AdminNavCollapsedState>>;

function createAdminNavCollapsedStore(): AdminNavCollapsedStore {
  return create<AdminNavCollapsedState>((set) => ({
    collapsed: false,
    setCollapsed: (collapsed) => set({ collapsed }),
  }));
}

let instance: AdminNavCollapsedStore | undefined;

function resolveStore(): AdminNavCollapsedStore {
  instance ??= createAdminNavCollapsedStore();
  return instance;
}

function useAdminNavCollapsedStoreHook<T>(selector: (state: AdminNavCollapsedState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, with the hook + getState/setState surface call sites and tests use. */
export const useAdminNavCollapsedStore = Object.assign(useAdminNavCollapsedStoreHook, {
  getState: (): AdminNavCollapsedState => resolveStore().getState(),
  setState: (partial: Partial<AdminNavCollapsedState>): void => resolveStore().setState(partial),
});
