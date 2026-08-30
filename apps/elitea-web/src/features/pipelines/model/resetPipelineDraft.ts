/**
 * Drop the in-memory flow-editor draft, restoring both singleton stores to
 * their last-loaded/saved snapshot.
 *
 * Why this exists as a public export: `pages/pipelines/EditPipeline.tsx`'s
 * Discard used to be `form.reset()` alone, while the save path reads the LIVE
 * graph through `usePipelineGraphDraft()` — so a user who edited the canvas,
 * clicked Cancel→Discard, and later clicked Save had the "discarded" edits
 * silently persisted. The page cannot reach `./pipelineYamlStore.ts` /
 * `./pipelineEditorStore.ts` directly (`no-deep-slice-import` forbids a page
 * importing past this slice's `index.ts` — the same reason
 * `usePipelineGraphDraft` exists as the read-side export), so this is the
 * matching write-side escape hatch.
 *
 * The pairing mirrors `ui/usePipelineEditorLifecycle.ts`'s
 * `usePipelineIdentityReset` exactly: `resetPipelineYaml()` restores
 * `yamlCode`/`yamlJsonObject` from the `initPipelineYaml` snapshot and raises
 * `resetFlag` (so a still-mounted `FlowEditor` snaps its canvas back), and
 * `resetPipelineEditor()` clears the node/edge copies the save path's
 * `calculateNodesAndEdges` would otherwise read as its geometry hint.
 */
import { usePipelineEditorStore } from './pipelineEditorStore';
import { usePipelineYamlStore } from './pipelineYamlStore';

export function resetPipelineDraft(): void {
  usePipelineYamlStore.getState().resetPipelineYaml();
  usePipelineEditorStore.getState().resetPipelineEditor();
}
