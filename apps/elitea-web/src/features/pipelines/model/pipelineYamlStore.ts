/**
 * Zustand port of the `yamlCode`/`yamlJsonObject`/`initState`/`resetFlag`/
 * `layout_version` fields of `apps/elitea-ui/src/slices/pipeline.js` — the
 * pipeline-editing workspace's YAML-round-trip and flow-editor-reset state.
 *
 * `./pipelineEditorStore.ts` (unit A2d) already ported this SAME Redux
 * slice's `stateValidationErrors` field (plus `slices/pipelineEditor.js`'s
 * `nodes`/`edges`) and its own doc comment explicitly scopes out
 * `yamlJsonObject`/`yamlCode`/`orientation`/`resetFlag`/`initState`,
 * assigning them to "whichever sub-unit owns the pipeline-editor PAGE/
 * composition root to build, scoped to what it actually needs" — that is
 * this sub-unit (A2n owns `ConfigurationTab.tsx`/`EditorPanel.tsx`, the
 * composition root and its YAML-editor panel). This file is a SEPARATE
 * store, not an edit to `pipelineEditorStore.ts` (outside this sub-unit's
 * owned-file fence), matching the same lazy-singleton factory pattern
 * (R-S2: no store created at module scope).
 *
 * **Already consumed by two sibling units landed later in this shared
 * worktree** (`src/features/pipelines/ui/PipelineEditor.tsx`, unit A2l;
 * `src/features/pipelines/ui/usePipelineEditorLifecycle.ts`, same unit) —
 * verified directly before this revision: `usePipelineIdentityReset` calls
 * `usePipelineYamlStore.getState().resetPipelineYaml()` (zero args) on an
 * identity switch; `usePipelineVersionSync` calls `usePipelineYamlStore.
 * getState().initPipelineYaml({ yamlCode, yamlJsonObject })` (exactly this
 * two-field shape) after loading+parsing a version. Both call signatures are
 * preserved byte-for-byte below — this revision only changes
 * `resetPipelineYaml`'s INTERNAL behaviour (see its own doc comment) and
 * ADDS fields/methods, it does not touch either already-landed call site's
 * contract.
 *
 * **`resetFlag`/`layoutVersion` added in this revision** — real evidence
 * this sub-unit's own `EditorPanel.tsx` needs them, now that sibling unit
 * A2k's `FlowEditor.tsx` has landed with `resetFlag`/`layoutVersion` (baseline
 * `state.pipeline.resetFlag`/`layout_version`) as REQUIRED explicit props
 * (`FlowEditor.tsx`'s own doc comment: "Everything else `slices/pipeline.js`
 * owned ... has no such home yet ... that's this component" — i.e.
 * whichever file composes `<FlowEditor>`, which is `EditorPanel.tsx`, A2n's
 * own file). `PipelineEditor.tsx`'s own doc comment independently confirms
 * the same gap ("`resetFlag` ... `layout_version` ... have NO consumer
 * anywhere in this worktree"). Extending this store (rather than local
 * `useState` in `EditorPanel.tsx`) is the right home: `resetPipelineYaml()`
 * — already called by the landed `usePipelineIdentityReset`/`PipelineEditor.
 * tsx`'s own `handleDiscard` — is the real, existing trigger for a
 * flow-editor reset (baseline `resetPipeline` reducer sets
 * `state.resetFlag = true` in the SAME reducer that restores `yamlJsonObject`
 * from `initState`), so wiring `resetFlag` in here means those two
 * already-landed call sites get correct flow-editor-reset behaviour for
 * free, with no changes needed on their side.
 *
 * **`resetPipelineYaml` behaviour correction:** the PREVIOUS revision of
 * this file wiped `yamlCode`/`yamlJsonObject` to empty — an invented
 * behaviour, not a port of anything. The real baseline `resetPipeline`
 * reducer (`slices/pipeline.js:45-54`) restores `yamlCode`/`yamlJsonObject`
 * from `state.initState` (the last loaded/saved snapshot), NOT to empty —
 * correct for `PipelineEditor.tsx`'s real "discard changes" call site
 * (`handleDiscard`, which must revert to what was loaded, not blank the
 * editor). `initYamlJsonObject` is added alongside the already-existing
 * `initYamlCode` so this snapshot is available to restore from.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';

export interface PipelineYamlState {
  readonly yamlCode: string;
  readonly yamlJsonObject: Readonly<Record<string, unknown>>;
  /** Baseline `initState.yamlCode` — the last-saved/loaded YAML, used for dirty-checking and as `resetPipelineYaml`'s restore target. */
  readonly initYamlCode: string;
  /** Baseline `initState.yamlJsonObject` — `resetPipelineYaml`'s restore target for the parsed graph. */
  readonly initYamlJsonObject: Readonly<Record<string, unknown>>;
  /** Baseline `resetFlag` — set by `resetPipelineYaml`, cleared by `clearResetFlag`; `EditorPanel.tsx` forwards it to `FlowEditor`'s `resetFlag` prop. */
  readonly resetFlag: boolean;
  /** Baseline `layout_version` — `undefined` until `setLayoutVersion` runs, matching the baseline's `''` initial value (never equal to a real version string, so the first auto-relayout always fires). */
  readonly layoutVersion: string | undefined;
  readonly setYamlCode: (code: string) => void;
  readonly setYamlJsonObject: (yamlJsonObject: Readonly<Record<string, unknown>>) => void;
  /** Baseline `initThePipeline`, scoped to the yaml fields — seeds both the current and the "saved" snapshot together (a fresh load). Signature fixed: two already-landed sibling call sites depend on it exactly as declared. */
  readonly initPipelineYaml: (input: { readonly yamlCode: string; readonly yamlJsonObject: Readonly<Record<string, unknown>> }) => void;
  /** Baseline `updateInitState` — marks the CURRENT `yamlCode` as the new saved snapshot without touching `yamlJsonObject`, matching the baseline's own scoped update. */
  readonly markYamlCodeSaved: () => void;
  /** Baseline `resetPipeline` — restores `yamlCode`/`yamlJsonObject` from the last `initPipelineYaml` snapshot and sets `resetFlag = true`. Zero-arg: two already-landed sibling call sites depend on it exactly as declared. */
  readonly resetPipelineYaml: () => void;
  /** Baseline `clearResetFlag`. */
  readonly clearResetFlag: () => void;
  /** Baseline `setLayoutVersion`. */
  readonly setLayoutVersion: (version: string) => void;
}

type PipelineYamlStore = UseBoundStore<StoreApi<PipelineYamlState>>;

const EMPTY_YAML_OBJECT: Readonly<Record<string, unknown>> = {};

export function createPipelineYamlStore(): PipelineYamlStore {
  return create<PipelineYamlState>((set, get) => ({
    yamlCode: '',
    yamlJsonObject: EMPTY_YAML_OBJECT,
    initYamlCode: '',
    initYamlJsonObject: EMPTY_YAML_OBJECT,
    resetFlag: false,
    layoutVersion: undefined,
    setYamlCode: (code) => set({ yamlCode: code }),
    setYamlJsonObject: (yamlJsonObject) => set({ yamlJsonObject: { ...yamlJsonObject } }),
    initPipelineYaml: ({ yamlCode, yamlJsonObject }) =>
      set({
        yamlCode,
        yamlJsonObject: { ...yamlJsonObject },
        initYamlCode: yamlCode,
        initYamlJsonObject: { ...yamlJsonObject },
        // Baseline `initThePipeline` reducer also sets `state.resetFlag = true`
        // (`slices/pipeline.js`) — every load/reload of a pipeline version must
        // re-sync the flow-editor canvas, exactly like `resetPipelineYaml`
        // already does below. Missing this meant `EditorPanel`/`FlowEditor`
        // could silently keep showing STALE canvas content across a version
        // reload whenever they stayed mounted (`usePipelineVersionSync`'s own
        // call site — switching versions without unmounting the editor).
        resetFlag: true,
      }),
    markYamlCodeSaved: () => set({ initYamlCode: get().yamlCode }),
    resetPipelineYaml: () => {
      const { initYamlCode, initYamlJsonObject } = get();
      set({ yamlCode: initYamlCode, yamlJsonObject: { ...initYamlJsonObject }, resetFlag: true });
    },
    clearResetFlag: () => set({ resetFlag: false }),
    setLayoutVersion: (version) => set({ layoutVersion: version }),
  }));
}

let instance: PipelineYamlStore | undefined;

function resolveStore(): PipelineYamlStore {
  instance ??= createPipelineYamlStore();
  return instance;
}

function usePipelineYamlStoreHook<T>(selector: (state: PipelineYamlState) => T): T {
  return resolveStore()(selector);
}

/** @public The lazily-constructed singleton, exposed with the same hook + getState/setState surface `pipelineEditorStore.ts` already establishes. */
export const usePipelineYamlStore = Object.assign(usePipelineYamlStoreHook, {
  getState: (): PipelineYamlState => resolveStore().getState(),
  setState: (partial: Partial<PipelineYamlState>): void => resolveStore().setState(partial),
});
