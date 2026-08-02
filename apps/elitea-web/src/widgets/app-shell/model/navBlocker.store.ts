/**
 * The cross-feature "unsaved changes" navigation-blocker flag set (old app:
 * Redux `state.settings.navBlocker`, `slices/settings.js`; consumed by
 * `components/UnsavedDialog.jsx` + `hooks/useNavBlocker.js`, SET by every
 * agent/pipeline/toolkit/artifact/canvas EDITOR page in the old app).
 *
 * **Known layering gap, flagged rather than silently worked around:** this
 * store's natural home is `entities/` or `shared/lib/` — every future
 * editor-owning feature (agents, pipelines, toolkits, artifacts, chat
 * canvas) needs to SET these flags, and `features/**` sits BELOW
 * `widgets/**` in the layer order (spec §3.2:
 * `app → processes → pages → widgets → features → entities → shared`), so
 * a `features/*` slice importing FROM `widgets/app-shell` would be an
 * upward import `dependency-cruiser`'s `no-upward-from-features` rule
 * rejects. This unit's ownership fence is exactly `src/widgets/{sidebar,
 * create-button,app-shell}/` — moving this store down a layer is outside
 * it. Built here anyway (rather than left out entirely) because the
 * CONSUMING half — the blocking dialog itself, wired to a real
 * `useBlocker` — is squarely this unit's job ("a navigation blocker
 * (unsaved-changes guard)", task brief) and has a real, working default
 * (nothing blocks) with zero features setting the flags yet. Flagging this
 * for whoever next touches the layer boundaries: relocate this store's
 * state (not necessarily the dialog UI) one layer down before any
 * `features/*` unit needs to set it.
 *
 * Lazy-singleton factory pattern — see `widgets/sidebar/model/
 * sidebarCollapsed.store.ts`'s header for the R-S2 rationale.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export type StreamingType = 'prompt' | 'canvas';

interface NavBlockerState {
  readonly isBlockNav: boolean;
  readonly isStreaming: boolean;
  readonly streamingType: StreamingType;
  readonly warningMessage: string;
  readonly isEditingAgent: boolean;
  readonly isEditingPipeline: boolean;
  readonly isEditingToolkit: boolean;
  readonly setBlockNav: (blocked: boolean, message?: string) => void;
  readonly setStreamingBlockNav: (streaming: boolean, type: StreamingType) => void;
  readonly setEditingAgent: (editing: boolean) => void;
  readonly setEditingPipeline: (editing: boolean) => void;
  readonly setEditingToolkit: (editing: boolean) => void;
}

const DEFAULT_WARNING = 'You have unsaved changes. Are you sure you want to leave this page?';

type NavBlockerStore = UseBoundStore<StoreApi<NavBlockerState>>;

export function createNavBlockerStore(): NavBlockerStore {
  return create<NavBlockerState>((set) => ({
    isBlockNav: false,
    isStreaming: false,
    streamingType: 'prompt',
    warningMessage: DEFAULT_WARNING,
    isEditingAgent: false,
    isEditingPipeline: false,
    isEditingToolkit: false,
    setBlockNav: (blocked, message) => set({ isBlockNav: blocked, warningMessage: message ?? DEFAULT_WARNING }),
    setStreamingBlockNav: (streaming, type) => set({ isStreaming: streaming, streamingType: type }),
    setEditingAgent: (editing) => set({ isEditingAgent: editing }),
    setEditingPipeline: (editing) => set({ isEditingPipeline: editing }),
    setEditingToolkit: (editing) => set({ isEditingToolkit: editing }),
  }));
}

let instance: NavBlockerStore | undefined;

function resolveStore(): NavBlockerStore {
  instance ??= createNavBlockerStore();
  return instance;
}

function useNavBlockerStoreHook<T>(selector: (state: NavBlockerState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the same hook + getState/setState surface every call site (and every test) already uses. */
export const useNavBlockerStore = Object.assign(useNavBlockerStoreHook, {
  getState: (): NavBlockerState => resolveStore().getState(),
  setState: (partial: Partial<NavBlockerState>): void => resolveStore().setState(partial),
});
