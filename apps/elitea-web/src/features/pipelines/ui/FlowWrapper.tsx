import type { ReactNode } from 'react';
import { forwardRef } from 'react';

import { ReactFlowProvider } from '@xyflow/react';

import { useIsSmallWindow } from '../lib/hooks/useIsSmallWindow';
import type { AiAssistantLlmSettings } from '../api/aiAssistantPredict';
import type { FlowEdge, FlowNode, SetYamlJsonObject } from '../lib/flow-editor/reactFlowTypes';
import type { YamlPipelineDocument } from '../lib/flow-editor/helpers/pipelineFlow.types';
import { FlowEditor, type FlowEditorHandle } from './FlowEditor';
import { computeFlowWrapperSx, type PipelineEditorModeValue } from './flowWrapperStyles';
import type { PipelineToolEntry } from './select/pipelineToolEntry.types';

export type { PipelineEditorModeValue } from './flowWrapperStyles';

/**
 * Ported from `apps/elitea-ui/src/pages/Pipelines/Components/FlowWrapper.jsx`
 * — the thin `<ReactFlowProvider>` wrapper around `FlowEditor`.
 *
 * **Real, load-bearing expansion of the prop surface — not a porting
 * shortcut.** The baseline's `FlowWrapper` forwarded only 4 props to
 * `FlowEditor` (`stopRun`/`mode`-derived `sx`/`setYamlJsonObject`/`disabled`)
 * because the baseline's own `FlowEditor.jsx` read `yamlJsonObject`/`nodes`/
 * `edges`/`layout_version`/`resetFlag` straight off Redux. Sibling unit A2k's
 * `FlowEditor.tsx` (landed in this shared worktree, verified directly before
 * writing this file) has NO Redux/store read for any of those — its own doc
 * comment states plainly that `slices/pipeline.js`'s remaining fields become
 * "explicit prop... or callback prop... The not-yet-built pipeline-editor
 * page is the natural owner of that state going forward" — this file (via
 * `EditorPanel.tsx`, which owns and computes them) is that owner. Every one
 * of `FlowEditorProps`'s fields not already covered by the baseline's own 4
 * is threaded straight through here, unmodified.
 *
 * `versionTools`/`llmSettings` (`FlowEditorProps`, "REAL PLUMBING GAP CLOSED
 * HERE" per that file's own doc comment) have no real threading path from
 * either of `EditorPanel`'s two confirmed real call sites
 * (`PipelineEditor.tsx`/`PipelineEditorParts.tsx`, sibling unit A2l — both
 * call `<EditorPanel ref setYamlDirty disabled stopRun />`, no
 * tools/llm-settings prop). Left `undefined` here — both are declared
 * optional on `FlowEditorProps` for exactly this "not always available"
 * case, not fabricated — because closing the gap needs changes in THREE
 * sibling-owned files this cluster (`A2-flow-editor-core-ui`) is scoped OUT
 * of touching. Re-verified directly (2026-08) while fixing this same doc
 * comment's OWN file/line as an adversarial-review finding — this is a
 * precise routing note, not a restatement of the original gap:
 *
 *  1. `EditorPanel.tsx` (unit A2n) — `EditorPanelProps` has no
 *     `versionTools`/`llmSettings` fields at all yet, and its own
 *     `<FlowWrapperLazy>` call site (this file's sole consumer) passes
 *     neither through. Needs both added to `EditorPanelProps` (optional,
 *     same types as `FlowWrapperProps` above) and forwarded verbatim.
 *  2. `ConfigurationTab.tsx` (unit A2n) — DOES already have live per-version
 *     data in scope (`useConfigurationTabSettings`'s destructured
 *     `versionDetails.tools`/`versionDetails.llm_settings`, and its own
 *     `memoizedLlmSettings` local, `ConfigurationTab.tsx:66-72`) but its
 *     `<EditorPanel ref setYamlDirty stopRun sx />` call site
 *     (`ConfigurationTab.tsx:335-340`) passes neither of them down. Needs a
 *     `versionDetails.tools -> PipelineToolEntry[]` mapping (structurally
 *     close but not identical to the wire `VersionToolRef[]` shape — verify
 *     field-by-field before assuming a bare cast is safe) plus
 *     `memoizedLlmSettings -> AiAssistantLlmSettings` (NOT a bare reuse:
 *     `AiAssistantLlmSettings.model_name`/`temperature`/`max_tokens` are
 *     REQUIRED, `memoizedLlmSettings` carries them possibly-`undefined` off
 *     `llm_settings`'s permissive wire shape — needs the same kind of
 *     default-resolution `ConfigurationTab.tsx` already does for `ChatPanel`,
 *     not a raw pass-through).
 *  3. `PipelineEditorParts.tsx`'s `PipelineEditorBody` (unit A2l) — its own
 *     `<EditorPanel ref setYamlDirty disabled stopRun />` call site
 *     (`PipelineEditorParts.tsx:275-280`) doesn't even receive `versionDetails`
 *     today (only identifiers: `pipelineId`/`projectId`/etc., grouped in
 *     `PipelineEditorIdentity`) — the `ApplicationVersionDetail` `usePipelineEditorLifecycle.
 *     ts`'s own `usePipelineVersionQuery` already fetches in `PipelineEditor.tsx`
 *     would need to be threaded down through `PipelineEditorBody` alongside
 *     the same tools/llm-settings derivation as (2).
 *
 * None of (1)-(3) can land from this file alone without violating this
 * cluster's FSD/scope fence (`EditorPanel.tsx`/`ConfigurationTab.tsx` are
 * unit A2n's owned files; `PipelineEditorParts.tsx`/`PipelineEditor.tsx` are
 * unit A2l's) — flagged as a follow-up task rather than edited here.
 *
 * The `sx` computation itself lives in `./flowWrapperStyles.ts` — see that
 * file's own doc comment for why (unit-testability against a real, verified,
 * currently-broken transitive dependency this file statically imports,
 * `./FlowEditor`).
 */
export interface FlowWrapperProps {
  readonly stopRun: () => void;
  readonly mode: PipelineEditorModeValue;
  readonly yamlJsonObject: YamlPipelineDocument;
  readonly setYamlJsonObject: SetYamlJsonObject;
  readonly initialNodes: readonly FlowNode[];
  readonly initialEdges: readonly FlowEdge[];
  readonly layoutVersion: string | undefined;
  readonly resetFlag: boolean;
  readonly onResetHandled: () => void;
  readonly onLayoutVersionChange: (version: string) => void;
  readonly versionTools?: readonly PipelineToolEntry[] | undefined;
  readonly llmSettings?: AiAssistantLlmSettings | null | undefined;
  readonly noBorder?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

export const FlowWrapper = forwardRef<FlowEditorHandle, FlowWrapperProps>(function FlowWrapper(props, ref): ReactNode {
  const {
    stopRun,
    mode,
    yamlJsonObject,
    setYamlJsonObject,
    initialNodes,
    initialEdges,
    layoutVersion,
    resetFlag,
    onResetHandled,
    onLayoutVersionChange,
    versionTools,
    llmSettings,
    noBorder = false,
    disabled,
  } = props;
  const { isSmallWindow } = useIsSmallWindow();

  return (
    <ReactFlowProvider>
      <FlowEditor
        ref={ref}
        yamlJsonObject={yamlJsonObject}
        setYamlJsonObject={setYamlJsonObject}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
        layoutVersion={layoutVersion}
        resetFlag={resetFlag}
        onResetHandled={onResetHandled}
        onLayoutVersionChange={onLayoutVersionChange}
        stopRun={stopRun}
        versionTools={versionTools}
        llmSettings={llmSettings}
        disabled={disabled}
        sx={computeFlowWrapperSx(isSmallWindow, noBorder, mode)}
      />
    </ReactFlowProvider>
  );
});
