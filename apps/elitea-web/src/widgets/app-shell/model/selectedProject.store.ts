/**
 * The currently-selected project (old app: Redux `state.settings.project`,
 * `slices/settings.js`). A user SELECTION, not data derivable from any
 * query response (R-S1 is about not duplicating query-cache data — "which
 * project id is picked right now" has no query that returns it).
 *
 * Lazy-singleton factory pattern — see `widgets/sidebar/model/
 * sidebarCollapsed.store.ts`'s header for the full R-S2 rationale (the
 * lint rule is a blanket "no `create()` outside a function" check, not
 * scoped to files `app/` imports).
 *
 * Holds no persistence I/O of its own, for the same reason
 * `sidebarCollapsed.store.ts` doesn't — see
 * `../lib/selectedProjectPersistence.ts`'s header.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface SelectedProject {
  readonly id: string;
  readonly name: string;
}

interface SelectedProjectState {
  readonly project: SelectedProject | null;
  readonly setProject: (project: SelectedProject) => void;
}

type SelectedProjectStore = UseBoundStore<StoreApi<SelectedProjectState>>;

export function createSelectedProjectStore(): SelectedProjectStore {
  return create<SelectedProjectState>((set) => ({
    project: null,
    setProject: (project) => set({ project }),
  }));
}

let instance: SelectedProjectStore | undefined;

function resolveStore(): SelectedProjectStore {
  instance ??= createSelectedProjectStore();
  return instance;
}

function useSelectedProjectStoreHook<T>(selector: (state: SelectedProjectState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the same hook + getState/setState surface every call site (and every test) already uses. */
export const useSelectedProjectStore = Object.assign(useSelectedProjectStoreHook, {
  getState: (): SelectedProjectState => resolveStore().getState(),
  setState: (partial: Partial<SelectedProjectState>): void => resolveStore().setState(partial),
});
