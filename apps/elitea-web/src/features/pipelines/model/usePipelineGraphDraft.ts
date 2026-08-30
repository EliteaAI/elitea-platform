/**
 * The read side of a pipeline save: the LIVE flow-editor state, in the exact
 * shape the version-write endpoint carries.
 *
 * Ported from the baseline's `pages/Pipelines/useSavePipeline.js`
 * (`calculateNodesAndEdges`) plus the pipeline branch of
 * `hooks/application/useSaveVersion.js:97-105`:
 *
 * ```js
 * instructions: !isFromPipeline ? version_details.instructions : yamlCode,
 * pipeline_settings: isFromPipeline
 *   ? { nodes, edges, orientation: ORIENTATION.vertical, layout_version: LAYOUT_VERSION }
 *   : undefined,
 * ```
 *
 * where `{nodes, edges} = calculateNodesAndEdges(yamlCode, vertical, flowNodes)`
 * — i.e. the graph itself round-trips through `instructions` (the pipeline
 * YAML) and `pipeline_settings` carries the LAID-OUT node/edge geometry the
 * editor restores on the next load (`ui/usePipelineEditorLifecycle.ts`'s
 * `readSavedNodes` feeds it straight back into `doLayout`'s
 * previously-measured-heights hint).
 *
 * **Why this exists as a public export at all (#135).** `pages/pipelines`
 * cannot reach `../model/pipelineYamlStore.ts` / `../model/
 * pipelineEditorStore.ts` directly — `no-deep-slice-import` forbids a page
 * importing past a slice's `index.ts`. That was the stated reason
 * `pages/pipelines/useSavePipeline.ts` returned hardcoded empty
 * `nodes`/`edges`/`yamlCode`, and `lib/editPipelineMappers.ts` sent
 * `pipelineSettings: undefined` on every save: the live editor state was
 * genuinely unreachable. It cost users every graph edit they made — the PUT
 * answered 200 and the canvas came back empty on reload. This hook is that
 * missing read path, exported from the slice barrel so the page can use it.
 *
 * Returns a STABLE reader callback rather than a value: the save handler must
 * observe the stores at click time, and subscribing the page to every
 * keystroke in the YAML editor would re-render the whole editor tree.
 */
import { useCallback } from 'react';

import { load as loadYaml } from 'js-yaml';

import { LAYOUT_VERSION, ORIENTATION } from '../lib/flow-editor/constants/flowEditor.constants';
import { doLayout } from '../lib/flow-editor/helpers/layout.helpers';
import { parseYaml } from '../lib/flow-editor/helpers/parsePipeline.helpers';
import { judgeLivePipelineGraph, type LivePipelineGraphAdmission } from '../lib/livePipelineGraphAdmission';
import type { YamlPipelineDocument } from '../lib/flow-editor/helpers/pipelineFlow.types';
import type { FlowEdge, FlowNode } from '../lib/flow-editor/reactFlowTypes';
import { usePipelineEditorStore } from './pipelineEditorStore';
import { usePipelineYamlStore } from './pipelineYamlStore';

/** @public The `{instructions, pipelineSettings}` half of a version draft that only the live flow editor can supply. */
export interface PipelineGraphDraft {
  /** The live pipeline YAML — the baseline's `instructions: yamlCode` for a pipeline save. */
  readonly instructions: string;
  /**
   * Whether the native runtime would accept `instructions`, judged on the
   * SAME string this reader is about to hand to the PUT.
   *
   * It rides here rather than on its own hook because the caller that needs
   * it — `pages/pipelines/lib/useEditPipelineForm.ts`'s `handleSave` — needs
   * it at CLICK time and must not subscribe the whole editor page to every
   * keystroke in the YAML editor (this module's own reason for returning a
   * reader instead of a value). The save gate's RHF `root.*` veto is not
   * enough on its own: `handleSubmit` deletes every `root.*` error before
   * deciding whether to submit (react-hook-form 7.83,
   * `dist/index.esm.mjs:3002`), so the veto is enforced only by the disabled
   * button — and the button can be enabled while the gate is unmounted, which
   * `ConfigurationTab` does whenever the detail refetch errors.
   */
  readonly admission: LivePipelineGraphAdmission;
  readonly pipelineSettings: {
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
    readonly orientation: string;
    readonly layout_version: string;
  };
}

/** Baseline `useSavePipeline.js`'s second named export, `calculateNodesAndEdges` — laid-out nodes/edges for a YAML document, seeded with the canvas's current node geometry. */
function calculateNodesAndEdges(
  yamlCode: string,
  flowNodes: readonly FlowNode[],
): { readonly nodes: readonly FlowNode[]; readonly edges: readonly FlowEdge[] } {
  let parsedYamlJson: YamlPipelineDocument | undefined;
  try {
    parsedYamlJson = loadYaml(yamlCode) as YamlPipelineDocument | undefined;
  } catch {
    // YAML parsing failed, parsedYamlJson remains undefined — same silent
    // fallthrough the baseline has, and the same one `usePipelineVersionSync`
    // uses on the read side.
    return { nodes: [], edges: [] };
  }
  const { nodes: parsedNodes, edges: parsedEdges } = parseYaml(parsedYamlJson, ORIENTATION.vertical);
  // `FlowGraphNode`/`FlowGraphEdge` are a wider struct than `@xyflow/react`'s
  // `Node`/`Edge` generics — the same explicit structural assignment
  // `usePipelineEditorLifecycle.ts` documents for the identical call.
  return doLayout({
    nodes: parsedNodes as unknown as readonly FlowNode[],
    edges: parsedEdges as unknown as readonly FlowEdge[],
    flowNodes,
    orientation: ORIENTATION.vertical,
  });
}

/**
 * @public
 * Returns a reader for the live flow-editor graph, or `undefined` when the
 * editor holds nothing to save.
 *
 * The `undefined` return is load-bearing, not defensive padding: a save
 * issued before `usePipelineVersionSync` has seeded the stores (or from a
 * screen with no flow editor mounted at all) would otherwise overwrite a
 * real, stored pipeline's `instructions` with an empty string — trading the
 * silent data loss of #135 for a louder one. The caller keeps the version's
 * already-loaded `instructions` in that case.
 */
export function usePipelineGraphDraft(): () => PipelineGraphDraft | undefined {
  return useCallback(() => {
    const yamlCode = usePipelineYamlStore.getState().yamlCode;
    if (yamlCode.trim() === '') return undefined;
    const flowNodes = usePipelineEditorStore.getState().nodes;
    const { nodes, edges } = calculateNodesAndEdges(yamlCode, flowNodes);
    return {
      instructions: yamlCode,
      admission: judgeLivePipelineGraph(yamlCode),
      pipelineSettings: {
        nodes,
        edges,
        orientation: ORIENTATION.vertical,
        layout_version: LAYOUT_VERSION,
      },
    };
  }, []);
}
