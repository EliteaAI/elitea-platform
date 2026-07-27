/**
 * Sidebar collapsed/expanded UI toggle (old app: Redux `state.settings.
 * sideBarCollapsed`, `slices/settings.js`). Purely local UI state — not
 * derivable from any query (R-S1) — so a zustand store is the right shape
 * (§2.3 "one store per feature slice").
 *
 * R-S2 ("no store may be created at module scope") is a BLANKET rule,
 * mechanically enforced by `tools/lint-rules/rules/no-module-scope-store.mjs`
 * against any `create()`/`createStore()` call not nested inside a function —
 * it does not special-case "only files `app/` imports" the way the rule's
 * prose motivation reads. `createSidebarCollapsedStore()` is the factory;
 * `useSidebarCollapsedStore` lazily constructs (and memoises) exactly one
 * instance on first use and re-exposes the full zustand surface
 * (`getState`/`setState`) callers already depend on, so every consumer in
 * this widget keeps using it exactly like a normal zustand hook — only this
 * file's internals changed shape.
 *
 * Deliberately holds NO storage I/O of its own — see
 * `../lib/collapsedPersistence.ts`'s header for why eagerly reading
 * `localStorage` inside a store creator is unsafe in the test environment.
 * `ui/Sidebar.tsx` hydrates the persisted value on mount and persists every
 * change through `setCollapsed`.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

interface SidebarCollapsedState {
  readonly collapsed: boolean;
  readonly setCollapsed: (collapsed: boolean) => void;
  readonly toggle: () => void;
}

type SidebarCollapsedStore = UseBoundStore<StoreApi<SidebarCollapsedState>>;

export function createSidebarCollapsedStore(): SidebarCollapsedStore {
  return create<SidebarCollapsedState>((set, get) => ({
    collapsed: false,
    setCollapsed: (collapsed) => set({ collapsed }),
    toggle: () => get().setCollapsed(!get().collapsed),
  }));
}

let instance: SidebarCollapsedStore | undefined;

function resolveStore(): SidebarCollapsedStore {
  instance ??= createSidebarCollapsedStore();
  return instance;
}

function useSidebarCollapsedStoreHook<T>(selector: (state: SidebarCollapsedState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the same hook + getState/setState surface every call site (and every test) already uses. */
export const useSidebarCollapsedStore = Object.assign(useSidebarCollapsedStoreHook, {
  getState: (): SidebarCollapsedState => resolveStore().getState(),
  setState: (partial: Partial<SidebarCollapsedState>): void => resolveStore().setState(partial),
});
