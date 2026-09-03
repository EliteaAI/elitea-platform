/**
 * "The Branding page has unsaved changes" — the one flag its navigation guard
 * reads (ADR-0024 WP4).
 *
 * A store rather than a component prop, for the reason `widgets/app-shell/
 * ui/NavBlockerDialog.tsx` records (#133): TanStack Router calls
 * `shouldBlockFn` at NAVIGATION time, and a closure over a rendered value can
 * only see the last committed render. The page lowers this flag and may
 * navigate in the same event (a successful save, a confirmed reset), before
 * React has re-rendered the guard — so the guard reads `getState()` live.
 *
 * The admin SPA does not mount the app shell's `NavBlockerDialog` (its root is
 * `AdminLayout`), and pulling `widgets/app-shell` into the admin bundle would
 * drag the whole shell into the initial chunk (#493). The page carries its own
 * guard, `BrandingNavGuard.tsx`, over this flag.
 *
 * Factory + lazy instance, as `adminNavCollapsed.ts` does, so R-S2
 * (`elitea/no-module-scope-store`) stays satisfied.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

interface BrandingDirtyState {
  readonly dirty: boolean;
  readonly setDirty: (dirty: boolean) => void;
}

type BrandingDirtyStore = UseBoundStore<StoreApi<BrandingDirtyState>>;

function createBrandingDirtyStore(): BrandingDirtyStore {
  return create<BrandingDirtyState>((set) => ({
    dirty: false,
    setDirty: (dirty) => set({ dirty }),
  }));
}

let instance: BrandingDirtyStore | undefined;

function resolveStore(): BrandingDirtyStore {
  instance ??= createBrandingDirtyStore();
  return instance;
}

function useBrandingDirtyStoreHook<T>(selector: (state: BrandingDirtyState) => T): T {
  return resolveStore()(selector);
}

export const useBrandingDirtyStore = Object.assign(useBrandingDirtyStoreHook, {
  getState: (): BrandingDirtyState => resolveStore().getState(),
  setState: (partial: Partial<BrandingDirtyState>): void => resolveStore().setState(partial),
});
