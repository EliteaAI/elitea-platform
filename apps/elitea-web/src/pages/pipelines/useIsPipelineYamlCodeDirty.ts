import { useIsFromChat, useIsFromPipelineDetail } from './lib/routeMatch';

/**
 * Ported from
 * `apps/elitea-ui/src/pages/Pipelines/useIsPipelineYamlCodeDirty.js` —
 * "has the pipeline's live YAML editor state diverged from what was last
 * loaded", consumed by the baseline's `entities/application-tab-bar/ui/
 * ApplicationTabBar.jsx` and `Components/EditorPanel.jsx` to decide whether
 * to show an unsaved-changes indicator / block navigation.
 *
 * **Real, disclosed constraint — same gap `useSavePipeline.ts` (this same
 * unit) documents in full:** the baseline compares `state.pipeline.yamlCode`
 * against a re-dumped (`DumpYamlHelpers.dumpYaml`) `state.pipeline.
 * initState.yamlCode`, both read off Redux. Neither the live YAML string nor
 * `DumpYamlHelpers` is reachable from `pages/pipelines`: `features/
 * pipelines/model/pipelineEditorStore.ts` (the zustand equivalent of
 * `state.pipeline`/`state.pipelineEditor`) and `features/pipelines/lib/
 * flow-editor/helpers/yamlUpdate.helpers.ts` (`DumpYamlHelpers`'s new-app
 * home) are both real files but neither is exported from `features/
 * pipelines/index.ts` as of this unit (A2m) landing (verified: the barrel's
 * curated ≤20-export budget currently covers only the A2b fstring-
 * autocomplete/YAML-editor pair). depcruise's `no-deep-slice-import-cross-
 * slice` rule forbids reaching past that barrel.
 *
 * Since there is no legally-reachable live YAML state to compare, this hook
 * cannot honestly report "dirty" — it returns `false` unconditionally
 * (never a fabricated `true`/`false` derived from data it cannot read),
 * documented here rather than silently reinterpreted as "always clean".
 * `isFromPipelineDetail`/`isFromChat` (this unit's own `./lib/routeMatch.ts`)
 * ARE fully portable and are still read, matching the baseline's own two
 * inputs, so this hook is a one-line change (swap the `false` for the real
 * comparison) once a sibling A2 sub-unit promotes the store/helper pair.
 */
export function useIsPipelineYamlCodeDirty(): boolean {
  const isFromPipelineDetail = useIsFromPipelineDetail();
  const isFromChat = useIsFromChat();
  const isPipelineEditingContext = isFromPipelineDetail || isFromChat;

  // See doc comment above: the live yamlCode/initState.yamlCode comparison
  // is unreachable without a promoted `features/pipelines` store/helper
  // export, so this can never honestly resolve to `true` yet.
  const yamlCodeHasDiverged = false;

  return isPipelineEditingContext && yamlCodeHasDiverged;
}
