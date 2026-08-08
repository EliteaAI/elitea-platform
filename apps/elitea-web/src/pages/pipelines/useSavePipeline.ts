import { useIsFromChat, useIsFromPipelineDetail } from './lib/routeMatch';

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/useSavePipeline.js` — the
 * "is the current save action a pipeline save, and what live editor state
 * should it carry" hook `hooks/application/useCreateApplication.jsx`,
 * `useSaveNewVersion.js`, and `useSaveVersion.js` all call to branch between
 * an agent save and a pipeline save.
 *
 * **STALE-GAP NOTICE (#135).** The paragraphs this comment used to carry
 * here described `nodes`/`edges`/`yamlCode` as unreachable: the zustand
 * editor stores were not exported from `features/pipelines/index.ts`, and
 * the generated `VersionWriteRequest` had no `pipeline_settings` field, so
 * this hook returned empty values on purpose. BOTH halves of that gap are
 * now closed — `features/pipelines` exports `usePipelineGraphDraft` (the
 * live-graph reader, including the `calculateNodesAndEdges` port discussed
 * below) and `pipeline_settings` is on the endpoint contract
 * (`services/elitea-main/api/openapi/v2.yaml`). The real save path,
 * `pages/pipelines/lib/useEditPipelineForm.ts`, uses those directly.
 *
 * This hook has no caller in this worktree (verified: `grep -rn
 * useSavePipeline src` finds only doc-comment references and its own test).
 * It is left returning the same empty shape rather than rewired into a
 * second, competing read path — but it is NOT the place to add one.
 *
 * **Not ported: `calculateNodesAndEdges`** (the baseline file's second,
 * named export, `useSavePipeline.js:31-40`). Its only real call sites are
 * cross-slice (`hooks/application/useCreateApplication.jsx`,
 * `useSaveNewVersion.js`, `useSaveVersion.js` — owned by the `agents`
 * domain's own Wave-2 sub-units, per this batch's brief: "if you land this
 * after A1a, that's fine ... A1a needs its own resolution regardless of
 * your build order"), and it depends entirely on `ParsePipelineHelpers`/
 * `LayoutHelpers` (`features/pipelines/lib/flow-editor/helpers/
 * parsePipeline.helpers.ts`, `layout.helpers.ts`) — real files, but not
 * exported from `features/pipelines/index.ts` either (same gap cited
 * above), so there is no R-L3-legal way for `pages/pipelines` to depend on
 * them. Reimplementing pipeline-YAML-to-flow-layout logic locally would
 * duplicate a substantial algorithm this sub-unit does not own, rather than
 * disclose a real gap — so it is omitted, not faked.
 */
export interface UseSavePipelineResult {
  readonly isFromPipeline: boolean;
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly yamlCode: string;
}

const EMPTY_NODES: readonly unknown[] = [];
const EMPTY_EDGES: readonly unknown[] = [];

/**
 * Split out of `useSavePipeline` purely to document, in one place, the exact
 * baseline comment this hook otherwise reproduces verbatim
 * (`useSavePipeline.js:14-19`): "Determine if we're editing a pipeline: (1)
 * explicitly on pipeline detail pages, OR (2) in chat AND there's actual
 * pipeline YAML data ... distinguishes pipeline editing from agent editing
 * in chat." Half (2) needs `yamlJsonObject.nodes.length > 0` — unreachable
 * here per this file's own doc comment (the store gap above) — so only half
 * (1) is live; `isFromChat` is still read (matching the baseline's own
 * variable, kept for the disclosed-gap doc trail) but never contributes a
 * `true` on its own, since there is no real pipeline-YAML signal available
 * to AND it against.
 */
function resolveIsFromPipeline(isFromPipelineDetail: boolean, isFromChat: boolean): boolean {
  const hasPipelineData = false; // see doc comment above: yamlJsonObject.nodes is unreachable without the store.
  return isFromPipelineDetail || (isFromChat && hasPipelineData);
}

export function useSavePipeline(): UseSavePipelineResult {
  const isFromPipelineDetail = useIsFromPipelineDetail();
  const isFromChat = useIsFromChat();

  return {
    isFromPipeline: resolveIsFromPipeline(isFromPipelineDetail, isFromChat),
    nodes: EMPTY_NODES,
    edges: EMPTY_EDGES,
    yamlCode: '',
  };
}
